import type { FormatEnum } from 'sharp'
import { localOutputPath, runTimestamp, uniquifyOutputPath, withExtension } from 'src/runner/outputPath.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import { importSharp } from 'src/utils/lazySharp.ts'
import { getPngMetadataFromUint8Array } from 'src/image-utils/_getPngMetadata.ts'
import type { ComfyNodeId } from 'src/graph/ComfyNodeID.ts'
import { type AbsolutePath, asAbsolutePath, type Maybe, type SaveOptions } from 'src/types/index.ts'
import { bang } from 'src/utils/bang.ts'
import { exhaust } from 'src/utils/exhaust.ts'
import type { ComfyExecutionStatus } from 'src/runner/ComfyExecutionStatus.ts'
import type { ComfyWorkflow, ComfyWorkflowID, ExecutionSnapshot, ProgressReport } from 'src/runner/ComfyWorkflow.ts'

import type {
   ComfyImageInfo,
   PromptID,
   PendingWsItem,
   WsMsgExecuted,
   WsMsgExecuting,
   WsMsgExecutionError,
   WsMsgExecutionInterrupted,
   WsMsgExecutionSuccess,
} from 'src/runner/ComfyWsApi.ts'
import { MediaImage } from 'src/runner/MediaImage.ts'
import { extensionOf, isVideoFilename, mediaMime } from 'src/runner/mediaKinds.ts'
import { model3dMime } from 'src/runner/outputs3d.ts'
import { type HistoryReplay, historyReplay } from 'src/runner/historyReplay.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { logError, logInfo } from 'src/utils/log.ts'
import { previewMetadataNodeId } from 'src/runner/wsBinaryFrame.ts'

/** paths claimed by in-flight retrievals: two same-second runs on a
 * counter-resetting cloud host compute the same name before either writes.
 * A claim is released as soon as the write lands (the file itself then holds
 * the name) or fails (the name is free again) — the set never accumulates */
const CLAIMED_OUTPUT_PATHS = new Set<string>()

export type ComfyExecutionData = {
   id: PromptID
   graphID: ComfyWorkflowID
   executed: boolean
   error?: WsMsgExecutionError | WsMsgExecutionInterrupted | null
   /** why comfy-ts failed the run itself, when no ComfyUI message says it (the host lost the prompt) */
   reason?: string | null
   status?: ComfyExecutionStatus | null
}

/** one audio file an output node published, downloaded as the server wrote it.
 * `absPath` is null when saving is off: `bytes` is then the only copy */
export type ComfyAudioOutput = {
   nodeId: ComfyNodeId
   filename: string
   mime: string
   bytes: Uint8Array
   absPath: AbsolutePath | null
}

/** one video file an output node published (SaveVideo, SaveWEBM, VHS_VideoCombine), same
 * shape and same retrieval as an audio file */
export type ComfyVideoOutput = ComfyAudioOutput

/** one 3D file an output node published (SaveGLB, SaveGaussianSplat, SavePointCloud): a mesh, a point
 * cloud or a splat, same retrieval as an audio file. `format` is the lowercase extension (glb, ply, spz…) */
export type Comfy3DOutput = ComfyAudioOutput & { format: string }

/** one text output as an output node published it (`nodeKey` is null when the node left the snapshot) */
export type ComfyTextOutput = {
   nodeId: ComfyNodeId
   nodeKey: string | null
   text: string
}

export type ExecutionProgress = ProgressReport & {
   promptId: PromptID
   nodeName: string | null
   elapsedMs: number
   /** the executing node's OWN counter, in its own unit: sampler steps, or generated
    * tokens on a text node. Null between nodes. The global percent normalizes this away,
    * and the unit is the only live detail worth reading on a long node */
   nodeProgress: { value: number; max: number } | null
   /** the executing node's live display text, when it publishes one. A streaming generator
    * puts its partial answer here every few tokens */
   progressText: string | null
}

/** one live preview frame of a run: the image a sampler is forming, once per step */
export type ExecutionPreview = {
   promptId: PromptID
   /** the image as ComfyUI encoded it, jpeg or png */
   bytes: Uint8Array
   mime: string
   /** the node that sent the frame: the frame's own metadata when it names one (type 4 frames),
    * else the node executing when it arrived. Null when neither is known */
   nodeId: ComfyNodeId | null
   /** that node's class name in the sent prompt (`KSampler`), null when unknown */
   nodeName: string | null
   /** that node's own counter when the frame arrived (sampler step of total), null when unknown */
   step: { value: number; max: number } | null
   /** the raw metadata json of a type 4 frame (`node_id`, `prompt_id`, …), null on a type 1 frame */
   metadata: unknown
}

export class ComfyExecution {
   get host(): ComfyHost {
      return this.workflow.host
   }

   constructor(
      public workflow: ComfyWorkflow,
      public data: ComfyExecutionData,
      init: {
         snapshot?: ExecutionSnapshot
         save?: Maybe<boolean | SaveOptions>
         scrubHistory?: boolean
         ephemeral?: boolean
         onProgress?: Maybe<(p: ExecutionProgress) => void>
         onPreview?: Maybe<(p: ExecutionPreview) => void>
         logProgress?: boolean
      } = {},
   ) {
      // settings FIRST: onCreate flushes buffered ws messages whose handlers read them
      this.snapshot = init.snapshot ?? null
      this.save = init.save === true ? {} : init.save === false ? null : (init.save ?? null)
      this.scrubHistory = init.scrubHistory ?? false
      this.ephemeral = init.ephemeral ?? false
      this.onProgress = init.onProgress ?? null
      this.onPreview = init.onPreview ?? null
      this.logProgress = init.logProgress ?? false
      // register with the host so websocket messages route here,
      // then flush messages that arrived before we existed
      this.silenceWaitMs = this.host.runSilenceMs
      this.host.trackExecution(this)
      this.onCreate()
   }

   /** local disk saving, OPT-IN (architecture.md item 14); null = outputs stay in memory */
   save: Maybe<SaveOptions> = null
   /** delete this run's server history entry after `done` */
   scrubHistory: boolean = false
   /** this run's SaveImage nodes were rewritten to SaveImageWebsocket in the snapshot */
   ephemeral: boolean = false

   /** exactly what was sent to the host, frozen at send time (replayable) */
   snapshot: Maybe<ExecutionSnapshot> = null

   // ---- progress ----------------------------------------------------------
   /** called on every progress-relevant websocket message */
   onProgress: Maybe<(p: ExecutionProgress) => void> = null
   /** called on every live preview frame of this run. Null = frames are never decoded for it */
   onPreview: Maybe<(p: ExecutionPreview) => void> = null
   /** render a live single-line progress report to the console */
   logProgress: boolean = false
   readonly startedAt: number = Date.now()

   get progress(): ExecutionProgress {
      const report = this.progressGlobal
      return {
         ...report,
         promptId: this.data.id,
         nodeName: this.workflow.currentExecutingNode?.$schema.nameInComfy ?? null,
         elapsedMs: Date.now() - this.startedAt,
         nodeProgress: this.workflow.currentExecutingNode?.progress ?? null,
         progressText: this.progressText,
      }
   }

   private _lastLoggedLine: string = ''
   private emitProgress(): void {
      const p = this.progress
      this.onProgress?.(p)
      if (!this.logProgress) return
      const width = 12
      const filled = Math.round((p.percent / 100) * width)
      const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
      const node = p.nodeName ? ` · ${p.nodeName}` : ''
      // the node's own counter: sampler steps, or generated tokens. Core TextGenerate
      // publishes no partial text, so on it this is the only thing that moves
      const count = p.nodeProgress ? ` ${p.nodeProgress.value}/${p.nodeProgress.max}` : ''
      const line = `▶ [${bar}] ${p.percent.toFixed(0).padStart(3)}%${node}${count} · ${(p.elapsedMs / 1000).toFixed(0)}s`
      // a streaming node's newest words, on the same line: the run stays ONE line, and what
      // the model is writing is the thing worth watching on it
      const tail = p.progressText?.replaceAll('\n', ' ').trimEnd().slice(-60)
      const full = tail == null || tail === '' ? line : `${line} · …${tail}`
      if (full === this._lastLoggedLine) return
      this._lastLoggedLine = full
      if (globalThis.process?.stdout?.isTTY) process.stdout.write(`\r\x1b[2K${full}`)
      else console.log(full)
   }

   private finishProgressLine(): void {
      if (!this.logProgress) return
      const p = this.progress
      const outputs = [`${this.images.length} image(s)`]
      if (this.audios.length > 0) outputs.push(`${this.audios.length} audio(s)`)
      if (this.videos.length > 0) outputs.push(`${this.videos.length} video(s)`)
      if (this.models3d.length > 0) outputs.push(`${this.models3d.length} 3d model(s)`)
      if (this.texts.length > 0) outputs.push(`${this.texts.length} text(s)`)
      const line = `${this.status === 'Failure' ? '🔴' : '🟢'} ${this.status.toLowerCase()} in ${(p.elapsedMs / 1000).toFixed(1)}s · ${outputs.join(' · ')}`
      if (globalThis.process?.stdout?.isTTY) process.stdout.write(`\r\x1b[2K${line}\n`)
      else console.log(line)
   }

   // promise handle so that we can wait for this execution to finish.
   // resolves in BOTH success and failure — inspect `status` / `data.error`.
   private _resolve!: (value: this) => void
   done: Promise<this> = new Promise((resolve) => {
      this._resolve = resolve
   })

   log(...args: unknown[]): void {
      console.log(`[ComfyExecution#${this.data.id}]`, ...args)
   }

   onCreate(): void {
      const data: ComfyExecutionData = this.data
      const pending = this.host._pendingMsgs.get(data.id)
      if (pending == null) return
      this.log(`🟢 onCreate: ${pending.length} pending messages`)
      this.host._pendingMsgs.delete(data.id) // buffered once, never again
      for (const msg of pending) this.onPromptRelatedMessage(msg)
   }

   get progressGlobal(): ProgressReport {
      if (this.data.status === 'Success') return { countDone: 1, countTotal: 1, isDone: true, percent: 100 }
      return this.workflow.progressGlobal
   }

   get status(): 'New' | 'Scheduled' | 'Running' | 'Success' | 'Failure' {
      return this.data.status ?? 'New'
   }

   onPromptRelatedMessage = (msg: PendingWsItem): void => {
      // a run reconciled from /history can still hear its own end late: one end only
      if (this.ended) return
      this.heard()
      if (msg.type === 'execution_success' || msg.type === 'execution_error' || msg.type === 'execution_interrupted')
         this.ended = true
      const graph = this.workflow
      // replayed pre-registration binary frame: an OUTPUT only when the ws
      // saver was executing at this point of the stream, else a preview
      if (msg.type === 'binary_preview_frame') {
         if (this.wsOutputNodeExecuting) this.onWsImageOutput({ bytes: msg.bytes, mime: msg.mime })
         else this.onPreviewFrame(msg)
         return
      }
      if (msg.type === 'execution_start') return
      else if (msg.type === 'execution_cached') graph.onExecutionCached(msg)
      else if (msg.type === 'executing') this.onExecuting(msg)
      else if (msg.type === 'progress') graph.onProgress(msg)
      else if (msg.type === 'progress_state') {
         // per-node progress map; global progress is derived from the msgs above
      } else if (msg.type === 'executed') this.onExecuted(msg)
      else if (msg.type === 'execution_error') return void this.onError(msg)
      // the server sends no execution_success after an interrupt: this message ends the run
      else if (msg.type === 'execution_interrupted') return void this._finish({ status: 'Failure', error: msg })
      else if (msg.type === 'execution_success') return void this.onExecutionSuccess(msg)
      else {
         console.log(`🔴 UNEXPECTED MESSAGE:`, msg)
         return exhaust(msg)
      }
      this.emitProgress()
   }

   /** update pointer to the currently executing node */
   private onExecuting = (msg: WsMsgExecuting): void => {
      this.workflow.onExecuting(msg)
   }

   private onExecutionSuccess = async (_msg: WsMsgExecutionSuccess): Promise<void> => {
      if (this.mayHaveMissedEvents) await this.retrieveMissedOutputs()
      await Promise.all(this.pendingPromises)
      return this._finish({ status: 'Success' })
   }

   private onError = async (msg: WsMsgExecutionError): Promise<void> => {
      console.error('❌ Execution error:')
      console.error(msg)
      return this._finish({ status: 'Failure', error: msg })
   }

   /** update execution list */
   private onExecuted = (msg: WsMsgExecuted): void => {
      const promptNodeID = msg.data.node
      this.heardExecuted.add(promptNodeID)
      // a STRING output reaches the client ONLY through an output node's ui
      // payload (PreviewAny), never through the prompt result
      for (const entry of msg.data.output?.text ?? []) {
         if (typeof entry !== 'string') continue
         const nodeKey = this.workflow.data.apiJson?.[promptNodeID]?.class_type ?? null
         this.texts.push({ nodeId: promptNodeID, nodeKey, text: entry })
      }
      // a video file rides `images` (SaveVideo), `video` or `gifs` (VideoHelperSuite): the
      // extension decides, so an animated webp or gif stays an image
      const out = msg.data.output
      // a loader (LoadVideo) echoes the file it READ, typed 'input': a preview, never an output
      const listed = [...(out?.images ?? []), ...(out?.video ?? []), ...(out?.gifs ?? [])].filter(
         (f) => f.type !== 'input',
      )
      for (const video of listed.filter((f) => isVideoFilename(f.filename))) {
         this.pendingPromises.push(
            this.retrieveFile(video, promptNodeID, mediaMime(video.filename)).then(
               (o) => void this.videos.push(o),
               (e: unknown) => {
                  console.error(`🔴 failed to retrieve ${video.filename}:`, e)
                  this.videoErrors.push({ video, error: e })
               },
            ),
         )
      }
      const images = listed.filter((f) => !isVideoFilename(f.filename))
      if (images.length > 0) {
         for (const img of images) {
            // guard every retrieval: one failed download must not hang `done`
            this.pendingPromises.push(
               this.retrieveImage(img, promptNodeID).catch((e: unknown) => {
                  console.error(`🔴 failed to retrieve ${img.filename}:`, e)
                  this.imageErrors.push({ image: img, error: e })
               }),
            )
         }
      }
      for (const audio of msg.data.output?.audio ?? []) {
         this.pendingPromises.push(
            this.retrieveFile(audio, promptNodeID, mediaMime(audio.filename)).then(
               (o) => void this.audios.push(o),
               (e: unknown) => {
                  console.error(`🔴 failed to retrieve ${audio.filename}:`, e)
                  this.audioErrors.push({ audio, error: e })
               },
            ),
         )
      }
      // a 3D loader echoes the file it READ, typed 'input', like LoadVideo
      for (const model3d of (out?.['3d'] ?? []).filter((f) => f.type !== 'input')) {
         this.pendingPromises.push(
            this.retrieveFile(model3d, promptNodeID, model3dMime(model3d.filename)).then(
               (o) => void this.models3d.push({ ...o, format: extensionOf(o.filename) }),
               (e: unknown) => {
                  console.error(`🔴 failed to retrieve ${model3d.filename}:`, e)
                  this.models3dErrors.push({ model3d, error: e })
               },
            ),
         )
      }
   }
   private pendingPromises: Promise<void>[] = []

   /** an end message arrived (or was replayed): every later message is ignored */
   private ended: boolean = false
   /** the output nodes whose `executed` reached us, so a /history replay never retrieves one twice */
   private heardExecuted: Set<string> = new Set()

   /** the run may have lost events (a reconnect, a long silence): its end reads /history for them */
   private mayHaveMissedEvents: boolean = false

   private replayUnheardOutputs(replay: HistoryReplay): void {
      for (const msg of replay.executed)
         if (msg.type === 'executed' && !this.heardExecuted.has(msg.data.node)) this.onExecuted(msg)
   }

   /** the history entry is written right after the end message is queued, so it may lag by a moment */
   historyRetry: { tries: number; ms: number } = { tries: 5, ms: 400 }

   /** a run that lived through a socket drop: an output node that ended in the gap is only in /history */
   private retrieveMissedOutputs = async (): Promise<void> => {
      const id = this.data.id
      for (let i = 0; i < this.historyRetry.tries; i++) {
         if (i > 0) await new Promise((r) => setTimeout(r, this.historyRetry.ms))
         try {
            const replay = historyReplay(await this.host.fetchHistory(id), id)
            if (replay == null) continue
            return this.replayUnheardOutputs(replay)
         } catch (e) {
            return logError(`run ${id}: its history did not answer (${extractErrorMessage(e)}); an output sent while the socket was down may be missing`)
         }
      }
      logError(`run ${id}: no history entry after its end; an output sent while the socket was down may be missing`)
   }

   // ---- reconcile over http (architecture.md, ResilientWebsocket.ts) ------------------------
   /** @internal the watchdog's clock: the last event of this run, and the last http check */
   lastHeardAt: number = Date.now()
   private lastCheckedAt: number = 0
   /** @internal the silence before the next http check: host.runSilenceMs, doubled after each check
    * that finds the run still on the host, up to host.runSilenceMaxMs; any event resets it */
   silenceWaitMs: number = 0
   /** @internal a check is in flight: never two at once */
   reconciling: boolean = false
   private loggedReconcileProblems: Set<string> = new Set()

   private heard(): void {
      this.lastHeardAt = Date.now()
      this.silenceWaitMs = this.host.runSilenceMs
   }

   /** @internal the run heard nothing for its current wait, and no check is in flight */
   isCheckDue(now: number): boolean {
      if (this.ended || this.reconciling) return false
      return now - Math.max(this.lastHeardAt, this.lastCheckedAt) >= this.silenceWaitMs
   }

   private logReconcileOnce(msg: string): void {
      if (this.loggedReconcileProblems.has(msg)) return
      this.loggedReconcileProblems.add(msg)
      logError(`run ${this.data.id}: ${msg}`)
   }

   /** @internal called before the host reads its queue, so a live end that lands during the reads
    * still looks for the outputs of the gap */
   beginReconcile(): void {
      this.reconciling = true
      this.mayHaveMissedEvents = true
   }

   /** @internal ask the host where this run stands. `queued` is the host's queue read BEFORE this
    * history read (the server moves a prompt from one to the other under one lock, so this order never
    * misses a run that ended between the two reads); null when it did not answer or its shape was not
    * recognised, and then the run is never declared lost. Says how the check ended */
   reconcile = async (queued: Set<string> | null): Promise<'history' | 'waiting' | 'lost'> => {
      this.beginReconcile()
      const id = this.data.id
      const hostId = this.host.data.id
      try {
         if (this.ended) return 'waiting'
         let replay: HistoryReplay | null
         try {
            replay = historyReplay(await this.host.fetchHistory(id), id)
         } catch (e) {
            this.logReconcileOnce(`the history of host '${hostId}' did not answer (${extractErrorMessage(e)}); waiting for its events`)
            return 'waiting'
         }
         if (this.ended) return 'waiting'
         if (replay == null) {
            if (queued == null || queued.has(id)) return 'waiting'
            const reason = `host '${hostId}' has it neither in its queue nor in its history (restarted while the socket was down ?)`
            logError(`run ${id}: ${reason}; the run fails`)
            this.ended = true
            await this._finish({ status: 'Failure', error: null, reason })
            return 'lost'
         }
         logInfo(`run ${id}: ended on host '${hostId}' without its end reaching the socket, finishing from its history`)
         for (const p of replay.problems) logError(`run ${id}: a history entry does not match the ws schemas, skipped: ${p}`)
         this.replayUnheardOutputs(replay)
         if (this.ephemeral)
            logError(`run ${id}: SaveImageWebsocket frames sent while the socket did not hear are lost (they never reach the server disk)`)
         if (replay.end != null) {
            this.onPromptRelatedMessage(replay.end)
            return 'history'
         }
         const reason = `its history entry on host '${hostId}' carries no end message`
         logError(`run ${id}: ${reason}; the run fails`)
         this.ended = true
         await this._finish({ status: 'Failure', error: null, reason })
         return 'history'
      } finally {
         this.reconciling = false
         this.lastCheckedAt = Date.now()
         this.silenceWaitMs = Math.min(this.silenceWaitMs * 2, this.host.runSilenceMaxMs)
      }
   }

   /** @internal one run checked alone (the host checks all its runs with one queue read) */
   reconcileAfterReconnect = async (): Promise<'history' | 'waiting' | 'lost'> => {
      this.beginReconcile()
      return this.reconcile(await this.host.fetchQueuedPromptIdsOrNull())
   }

   /** audio retrievals that failed (their files are missing from `audios`) */
   audioErrors: { audio: ComfyImageInfo; error: unknown }[] = []

   /** audio files retrieved for this execution, in arrival order (final once `done` resolves) */
   audios: ComfyAudioOutput[] = []

   /** video retrievals that failed (their files are missing from `videos`) */
   videoErrors: { video: ComfyImageInfo; error: unknown }[] = []

   /** video files retrieved for this execution, in arrival order (final once `done` resolves) */
   videos: ComfyVideoOutput[] = []

   /** 3D retrievals that failed (their files are missing from `models3d`) */
   models3dErrors: { model3d: ComfyImageInfo; error: unknown }[] = []

   /** 3D files retrieved for this execution, in arrival order (final once `done` resolves) */
   models3d: Comfy3DOutput[] = []

   /** one non-image file through /view, its bytes as the server wrote them; the caller files it */
   private retrieveFile = async (
      info: ComfyImageInfo,
      promptNodeID: ComfyNodeId,
      mime: string,
   ): Promise<ComfyAudioOutput> => {
      const response = await this.host.fetchFile('/view?' + new URLSearchParams(info).toString())
      const bytes = new Uint8Array(await response.arrayBuffer())
      const sf = this.save
      if (sf == null) return { nodeId: promptNodeID, filename: info.filename, mime, bytes, absPath: null }
      const promptPrefix = this.workflow.data.apiJson?.[promptNodeID]?.inputs['filename_prefix']
      const written = await this.encodeAndWrite({
         bytes,
         // never re-encoded: `save.format` is an image setting
         sf: { ...sf, format: 'raw' },
         filenamePrefix: typeof promptPrefix === 'string' ? promptPrefix : undefined,
         subfolder: info.subfolder,
         filename: info.filename,
      })
      return { nodeId: promptNodeID, filename: info.filename, mime, bytes, absPath: written.path }
   }

   /** image retrievals that failed (their images are missing from `images`);
    * `image` is null for SaveImageWebsocket frames (no server-side file info exists) */
   imageErrors: { image: Maybe<ComfyImageInfo>; error: unknown }[] = []

   retrieveImage = async (
      //
      comfyImageInfo: ComfyImageInfo,
      promptNodeID: ComfyNodeId,
   ): Promise<void> => {
      // retrieve the node
      const promptNode = this.workflow.data.apiJson?.[promptNodeID]
      if (promptNode == null) throw new Error(`❌ invariant violation: promptNode is null`)

      // image route on the host (cloud answers a 302 signed url — fetchFile follows it unauthed)
      const imgRoute = '/view?' + new URLSearchParams(comfyImageInfo).toString()
      const response = await this.host.fetchFile(imgRoute)
      const bytes = new Uint8Array(await response.arrayBuffer())

      const comfyUIInfos = { comfyImageInfo, comfyHostHttpURL: this.host.getServerHostHTTP() }

      // local saving is OPT-IN (architecture.md item 14): no save → in-memory only
      const sf = this.save
      if (sf == null) {
         return this.pushImage(
            new MediaImage({ buffer: bytes, execution: this, promptNodeID: promptNodeID, comfyUIInfos }),
            promptNodeID,
         )
      }

      const promptPrefix = promptNode.inputs['filename_prefix']
      const written = await this.encodeAndWrite({
         bytes,
         sf,
         filenamePrefix: typeof promptPrefix === 'string' ? promptPrefix : undefined,
         subfolder: comfyImageInfo.subfolder,
         filename: comfyImageInfo.filename,
      })
      this.pushImage(
         new MediaImage({
            path: written.path,
            buffer: written.bytes,
            execution: this,
            promptNodeID: promptNodeID,
            comfyUIInfos,
         }),
         promptNodeID,
      )
   }

   /** re-encode when asked, then write under OUR local naming — never the raw
    * server filename: a cloud host resets its _00001_ counter per run, so the
    * server name overwrote the same local file on every run */
   private encodeAndWrite = async (p: {
      bytes: Uint8Array
      sf: SaveOptions
      filenamePrefix?: string
      subfolder: string
      filename: string
   }): Promise<{ path: AbsolutePath; bytes: Uint8Array }> => {
      let bytes = p.bytes
      const reencode = p.sf.format != null && p.sf.format !== 'raw'
      if (reencode) {
         // PNG text chunk (workflow provenance) survives the re-encode as EXIF
         let textChunk = {}
         try {
            const res = getPngMetadataFromUint8Array(p.bytes)
            if (res.success) textChunk = res.value
         } catch {}

         const format = ((): keyof FormatEnum => {
            if (p.sf.format === 'image/jpeg') return 'jpeg'
            if (p.sf.format === 'image/webp') return 'webp'
            return 'png'
         })()

         // node-only branch: re-encoding needs sharp (save 'raw' is the web path)
         const sharp = await importSharp(`save format '${p.sf.format}' re-encoding`)
         const encoded = await sharp(p.bytes)
            .withMetadata()
            .withExif({ IFD0: textChunk })
            // sharp expect quality between 1 and 100
            .toFormat(format, p.sf.quality ? { quality: Math.round(p.sf.quality * 100) } : undefined)
            .toBuffer()
         bytes = new Uint8Array(encoded)
      }

      let absPath: string = comfyts.resolveFromOutput(
         localOutputPath({
            localDir: p.sf.prefix,
            filenamePrefix: p.filenamePrefix,
            subfolder: p.subfolder,
            filename: p.filename,
            timestamp: runTimestamp(new Date(this.startedAt)),
         }),
      )
      if (reencode) absPath = withExtension(absPath, bang(bang(p.sf.format).split('/')[1]))
      // last-resort uniquifier: bump past files on disk AND paths claimed by
      // still-downloading retrievals — never overwrite
      const storage = getComfyStorage()
      absPath = uniquifyOutputPath({ path: absPath, exists: (x) => storage.exists(x), claimed: CLAIMED_OUTPUT_PATHS })
      try {
         storage.writeBytes(asAbsolutePath(absPath), bytes)
      } finally {
         // the file (or the failure) now owns the name — holding the claim
         // forever would grow the set for the whole life of a `serve` process
         CLAIMED_OUTPUT_PATHS.delete(absPath)
      }
      return { path: asAbsolutePath(absPath), bytes }
   }

   /** accumulate an output on the prompt; tags from node metadata ride along */
   private pushImage(img: MediaImage, promptNodeID: Maybe<string>): void {
      const promptMeta = promptNodeID != null ? this.workflow.data.metadata?.[promptNodeID] : null
      if (promptMeta?.tag) img.tags.push(promptMeta.tag)
      if (promptMeta?.tags) img.tags.push(...promptMeta.tags)
      this.images.push(img)
   }

   /** true while the currently executing node is a SaveImageWebsocket in the
    * SENT snapshot (the ephemeral rewrite only touches the snapshot, so the
    * live graph may still say SaveImage) — binary frames are then OUTPUTS */
   get wsOutputNodeExecuting(): boolean {
      const uid = this.workflow.currentExecutingNode?.uid
      if (uid == null) return false
      const apiJson = this.snapshot?.apiJson ?? this.workflow.apiJson
      return apiJson[uid]?.class_type === 'SaveImageWebsocket'
   }

   /** @internal a live preview frame of this run; never an output (the host routes ws saver frames
    * to onWsImageOutput before they get here) */
   onPreviewFrame(p: { bytes: Uint8Array; mime: string; metadata: unknown }): void {
      this.heard()
      const listener = this.onPreview
      if (listener == null) return
      const current = this.workflow.currentExecutingNode
      const named = previewMetadataNodeId(p.metadata)
      const nodeId: ComfyNodeId | null = named ?? current?.uid ?? null
      const apiJson = this.snapshot?.apiJson ?? this.workflow.apiJson
      const counter = current != null && current.uid === nodeId ? current.progress : null
      listener({
         promptId: this.data.id,
         bytes: p.bytes,
         mime: p.mime,
         nodeId,
         nodeName: nodeId != null ? (apiJson[nodeId]?.class_type ?? null) : null,
         step: counter != null ? { value: counter.value, max: counter.max } : null,
         metadata: p.metadata,
      })
   }

   /** one binary ws frame = one output image of the executing SaveImageWebsocket
    * node (architecture.md item 14 — the zero-server-disk path) */
   onWsImageOutput = (p: { bytes: Uint8Array; mime: string }): void => {
      this.heard()
      const promptNodeID = this.workflow.currentExecutingNode?.uid ?? null
      this.pendingPromises.push(
         this.storeWsImage(p, promptNodeID).catch((e: unknown) => {
            console.error(`🔴 failed to store a SaveImageWebsocket output:`, e)
            this.imageErrors.push({ image: null, error: e })
         }),
      )
   }

   private storeWsImage = async (
      p: { bytes: Uint8Array; mime: string },
      promptNodeID: Maybe<string>,
   ): Promise<void> => {
      const sf = this.save
      if (sf == null) {
         return this.pushImage(new MediaImage({ buffer: p.bytes, execution: this, promptNodeID }), promptNodeID)
      }
      const ext = p.mime === 'image/jpeg' ? 'jpg' : (p.mime.split('/')[1] ?? 'png')
      const written = await this.encodeAndWrite({
         bytes: p.bytes,
         sf,
         subfolder: '',
         // ws frames carry no server filename — the workflow id is the stem
         filename: `${this.workflow.id}.${ext}`,
      })
      this.pushImage(
         new MediaImage({ path: written.path, buffer: written.bytes, execution: this, promptNodeID }),
         promptNodeID,
      )
   }

   /** images retrieved for this execution, in arrival order (final once `done` resolves) */
   images: MediaImage[] = []

   /** text outputs emitted for this execution, in arrival order (final once `done` resolves) */
   texts: ComfyTextOutput[] = []

   /** live display text per node WHILE it runs, newest wins (`send_progress_text` is a
    * replacement, not a delta). This is the only channel carrying text DURING a node: a
    * generator that streams its tokens shows up here, and nowhere in the final outputs */
   progressTexts: Map<string, string> = new Map()

   /** the node that most recently published live text — what "watch it work" means */
   progressText: string | null = null

   /** @internal a live-text frame for one node */
   onProgressText(p: { nodeId: string; text: string }): void {
      this.heard()
      this.progressTexts.set(p.nodeId, p.text)
      this.progressText = p.text
      this.emitProgress()
   }

   /** the last text output, the one a single-generator workflow means by "the result" */
   get text(): string | null {
      return this.texts.at(-1)?.text ?? null
   }

   update(data: Partial<ComfyExecutionData>): void {
      Object.assign(this.data, data)
   }

   private alreadyDone: boolean = false
   private _finish = async (p: Pick<ComfyExecutionData, 'status' | 'error' | 'reason'>): Promise<void> => {
      if (this.alreadyDone) throw new Error(`❌ invariant violation: already finished`)
      this.alreadyDone = true
      this.update({ ...p, executed: true })
      await Promise.all(this.pendingPromises)
      // finished executions receive no further messages — free the routing maps
      this.host.executions.delete(this.data.id)
      this.host._pendingMsgs.delete(this.data.id)

      // the inputs gap, stated loud (item 14): ephemeral covers OUTPUTS only —
      // uploaded inputs persist in the server's input/ dir, no upstream delete API
      if (this.ephemeral) {
         const classTypes = Object.values(this.snapshot?.apiJson ?? {}).map((n) => n.class_type)
         if (classTypes.includes('LoadImage') || classTypes.includes('LoadImageMask')) {
            console.warn(
               `🟡 ephemeral run ${this.data.id}: outputs never touched the server disk, but the graph's ` +
                  `LoadImage nodes reference files in the host's input/ folder (uploads persist — ComfyUI has ` +
                  `no delete API). Use MediaImage.loadInWorkflow_viaBase64Node to keep inputs off the server too.`,
            )
         }
      }

      // history scrub AFTER retrievals: loud but never fatal — a privacy
      // feature that crashes the run would push users to disable it
      if (this.scrubHistory) {
         await this.host.deleteHistory(this.data.id).catch((e: unknown) => {
            console.error(`🔴 failed to scrub history entry ${this.data.id} on host ${this.host.data.id}:`, e)
         })
      }

      this.finishProgressLine()
      this._resolve(this)
   }
}
