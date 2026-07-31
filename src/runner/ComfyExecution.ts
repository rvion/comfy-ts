import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'pathe'
import { localOutputPath, runTimestamp, uniquifyOutputPath } from 'src/runner/outputPath.ts'

/** paths claimed by in-flight retrievals: two same-second runs on a
 * counter-resetting cloud host compute the same name before either writes */
const CLAIMED_OUTPUT_PATHS = new Set<string>()
import sharp, { type FormatEnum } from 'sharp'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { getPngMetadataFromUint8Array } from 'src/image-utils/_getPngMetadata.ts'
import type { ComfyNodeId } from 'src/graph/ComfyNodeID.ts'
import { asAbsolutePath, type ImageSaveFormat, type Maybe } from 'src/types/index.ts'
import { exhaust } from 'src/utils/exhaust.ts'
import type { ComfyExecutionStatus } from 'src/runner/ComfyExecutionStatus.ts'
import type { ComfyWorkflow, ComfyWorkflowID, ExecutionSnapshot, ProgressReport } from 'src/runner/ComfyWorkflow.ts'

import type {
   ComfyImageInfo,
   PromptID,
   PromptRelated_WsMsg,
   WsMsgExecuted,
   WsMsgExecuting,
   WsMsgExecutionError,
   WsMsgExecutionSuccess,
} from 'src/runner/ComfyWsApi.ts'
import { MediaImage } from 'src/runner/MediaImage.ts'

export type ComfyExecutionData = {
   id: PromptID
   graphID: ComfyWorkflowID
   executed: boolean
   error?: WsMsgExecutionError | null
   status?: ComfyExecutionStatus | null
}

export type ExecutionProgress = ProgressReport & {
   promptId: PromptID
   nodeName: string | null
   elapsedMs: number
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
         saveFormat?: Maybe<ImageSaveFormat>
         onProgress?: Maybe<(p: ExecutionProgress) => void>
         logProgress?: boolean
      } = {},
   ) {
      // settings FIRST: onCreate flushes buffered ws messages whose handlers read them
      this.snapshot = init.snapshot ?? null
      this.saveFormat = init.saveFormat ?? null
      this.onProgress = init.onProgress ?? null
      this.logProgress = init.logProgress ?? false
      // register with the host so websocket messages route here,
      // then flush messages that arrived before we existed
      this.host.executions.set(data.id, this)
      this.onCreate()
   }

   // post-process
   saveFormat: Maybe<ImageSaveFormat> = null

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
      const line = `▶ [${bar}] ${p.percent.toFixed(0).padStart(3)}%${node} · ${(p.elapsedMs / 1000).toFixed(0)}s`
      if (line === this._lastLoggedLine) return
      this._lastLoggedLine = line
      if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${line}`)
      else console.log(line)
   }

   private finishProgressLine(): void {
      if (!this.logProgress) return
      const p = this.progress
      const line = `${this.status === 'Failure' ? '🔴' : '🟢'} ${this.status.toLowerCase()} in ${(p.elapsedMs / 1000).toFixed(1)}s · ${this.images.length} image(s)`
      if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${line}\n`)
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

   onPromptRelatedMessage = (msg: PromptRelated_WsMsg): void => {
      const graph = this.workflow
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

   /** image retrievals that failed (their images are missing from `images`) */
   imageErrors: { image: ComfyImageInfo; error: unknown }[] = []

   retrieveImage = async (
      //
      comfyImageInfo: ComfyImageInfo,
      promptNodeID: ComfyNodeId,
   ): Promise<void> => {
      // retrieve the node
      const promptNode = this.workflow.data.apiJson?.[promptNodeID]
      const promptMeta = this.workflow.data.metadata?.[promptNodeID]
      if (promptNode == null) throw new Error(`❌ invariant violation: promptNode is null`)

      // image route on the host (cloud answers a 302 signed url — fetchFile follows it unauthed)
      const imgRoute = '/view?' + new URLSearchParams(comfyImageInfo).toString()

      // target path on disk: OUR naming, never the raw server filename — a
      // cloud host resets its _00001_ counter per run, so the server name
      // overwrote the same local file on every run (his repro 2026-07-31)
      const sf = this.saveFormat
      const promptPrefix = promptNode.inputs['filename_prefix']
      let absPath: string = comfyts.resolveFromOutput(
         localOutputPath({
            localDir: sf?.prefix,
            filenamePrefix: typeof promptPrefix === 'string' ? promptPrefix : undefined,
            subfolder: comfyImageInfo.subfolder,
            filename: comfyImageInfo.filename,
            timestamp: runTimestamp(new Date(this.startedAt)),
         }),
      )
      if (sf?.format && sf.format !== 'raw') {
         const extension = sf.format.split('/')[1]
         absPath += '.' + extension
      }
      // last-resort uniquifier: bump past files on disk AND paths claimed by
      // still-downloading retrievals — never overwrite
      absPath = uniquifyOutputPath({ path: absPath, exists: existsSync, claimed: CLAIMED_OUTPUT_PATHS })
      const dir = dirname(absPath)
      mkdirSync(dir, { recursive: true })

      // ref
      let img: MediaImage

      // RE-ENCODE (COMPRESSED)
      if (sf && sf.format !== 'raw') {
         const response = await this.host.fetchFile(imgRoute)
         const buff = await response.arrayBuffer()
         let textChunk = {}
         try {
            const res = getPngMetadataFromUint8Array(new Uint8Array(buff))
            if (res.success) textChunk = res.value
         } catch {}

         const format = ((): keyof FormatEnum => {
            if (sf.format === 'image/jpeg') return 'jpeg'
            if (sf.format === 'image/png') return 'png'
            if (sf.format === 'image/webp') return 'webp'
            return 'png'
         })()

         await sharp(buff)
            .withMetadata()
            .withExif({ IFD0: textChunk })
            // sharp expect quality between 1 and 100
            .toFormat(format, sf.quality ? { quality: Math.round(sf.quality * 100) } : undefined)
            .toFile(absPath)

         img = new MediaImage({
            path: asAbsolutePath(absPath),
            execution: this,
            promptNodeID: promptNodeID,
            comfyUIInfos: {
               comfyImageInfo: comfyImageInfo,
               comfyHostHttpURL: this.host.getServerHostHTTP(),
            },
         })
      }

      // SAVE RAW ------------------------------------------------------------------------------------------
      else {
         const response = await this.host.fetchFile(imgRoute)
         const buff = await response.arrayBuffer()
         const uint8arr = new Uint8Array(buff)
         writeFileSync(absPath, uint8arr)
         img = new MediaImage({
            path: asAbsolutePath(absPath),
            buffer: uint8arr,
            execution: this,
            promptNodeID: promptNodeID,
            comfyUIInfos: {
               comfyImageInfo: comfyImageInfo,
               comfyHostHttpURL: this.host.getServerHostHTTP(),
            },
         })
      }

      // accumulate outputs on the prompt; tags from node metadata ride along
      if (promptMeta?.tag) img.tags.push(promptMeta.tag)
      if (promptMeta?.tags) img.tags.push(...promptMeta.tags)
      this.images.push(img)
   }

   /** images retrieved for this execution, in arrival order (final once `done` resolves) */
   images: MediaImage[] = []

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
      this.finishProgressLine()
      this._resolve(this)
   }
}
