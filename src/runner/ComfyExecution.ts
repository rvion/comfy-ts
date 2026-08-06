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
   WsMsgExecutionSuccess,
} from 'src/runner/ComfyWsApi.ts'
import { MediaImage } from 'src/runner/MediaImage.ts'

/** paths claimed by in-flight retrievals: two same-second runs on a
 * counter-resetting cloud host compute the same name before either writes.
 * A claim is released as soon as the write lands (the file itself then holds
 * the name) or fails (the name is free again) — the set never accumulates */
const CLAIMED_OUTPUT_PATHS = new Set<string>()

export type ComfyExecutionData = {
   id: PromptID
   graphID: ComfyWorkflowID
   executed: boolean
   error?: WsMsgExecutionError | null
   status?: ComfyExecutionStatus | null
}

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
         logProgress?: boolean
      } = {},
   ) {
      // settings FIRST: onCreate flushes buffered ws messages whose handlers read them
      this.snapshot = init.snapshot ?? null
      this.save = init.save === true ? {} : init.save === false ? null : (init.save ?? null)
      this.scrubHistory = init.scrubHistory ?? false
      this.ephemeral = init.ephemeral ?? false
      this.onProgress = init.onProgress ?? null
      this.logProgress = init.logProgress ?? false
      // register with the host so websocket messages route here,
      // then flush messages that arrived before we existed
      this.host.executions.set(data.id, this)
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
      const graph = this.workflow
      // replayed pre-registration binary frame: an OUTPUT only when the ws
      // saver was executing at this point of the stream; stale latents drop
      if (msg.type === 'binary_preview_frame') {
         if (this.wsOutputNodeExecuting) this.onWsImageOutput({ bytes: msg.bytes, mime: msg.mime })
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
      // a STRING output reaches the client ONLY through an output node's ui
      // payload (PreviewAny) — never through the prompt result
      for (const entry of msg.data.output?.text ?? []) {
         if (typeof entry !== 'string') continue
         const nodeKey = this.workflow.data.apiJson?.[promptNodeID]?.class_type ?? null
         this.texts.push({ nodeId: promptNodeID, nodeKey, text: entry })
      }
      const images = msg.data.output?.images
      if (images) {
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
   }
   private pendingPromises: Promise<void>[] = []

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

   /** one binary ws frame = one output image of the executing SaveImageWebsocket
    * node (architecture.md item 14 — the zero-server-disk path) */
   onWsImageOutput = (p: { bytes: Uint8Array; mime: string }): void => {
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
   private _finish = async (p: Pick<ComfyExecutionData, 'status' | 'error'>): Promise<void> => {
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
