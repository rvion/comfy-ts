import { spawn } from 'node:child_process'
import { makeAutoObservable, runInAction } from 'mobx'
import { basename } from 'pathe'
import type { ExecutionProgress } from 'src/runner/ComfyExecution.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { SeedVar } from 'src/vars/ComfyVars.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** run lifecycle + outputs + status line + clipboard/open actions */
export class ExecSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<ExecSt, 'st'>(this, { st: false })
   }

   /** runs we launched that have not finished (the server executes them FIFO) */
   inFlight: number = 0
   progress: ExecutionProgress | null = null
   outputs: string[] = []
   runCount: number = 0
   lastStatus: string | null = null
   error: string | null = null
   /** transient status line (copy feedback, draft changes, …) */
   notice: string | null = null
   /** the prompt currently executing on the server (progress belongs to it) */
   private currentPromptId: string | null = null

   get running(): boolean {
      return this.inFlight > 0
   }

   /** workflow switch: wipe run artifacts, keep a hello notice */
   resetForWorkflow(notice: string): void {
      this.outputs = []
      this.error = null
      this.notice = notice
      this.runCount = 0
      this.lastStatus = null
   }

   /** every run takes THIS path, queued ones included: same progress, outputs, previews */
   async run(): Promise<void> {
      const queued = this.running
      const host = this.st.wf.host
      runInAction(() => {
         this.inFlight++
         this.error = null
         if (queued) {
            this.notice = `queued another run (server queue: ${this.st.queue.remaining + 1})`
         } else {
            this.progress = null
            this.notice = null
            this.currentPromptId = null
            this.st.preview.reset()
            // installed while ANY run is in flight, so queued prompts keep painting latents
            host.onLatentPreview = (p) => void this.st.preview.renderLatent(p.bytes)
         }
      })
      try {
         const execution = await this.st.wf.run({
            onProgress: (p) => runInAction(() => this.onProgress(p)),
         })
         runInAction(() => {
            this.outputs = execution.images.map((i) => i.absPath)
            this.lastStatus = execution.status
            this.runCount++
         })
         const lastImage = execution.images[execution.images.length - 1]
         if (lastImage) void this.st.preview.renderOutput(lastImage.absPath)
      } catch (e) {
         runInAction(() => {
            this.error = extractErrorMessage(e)
         })
      } finally {
         runInAction(() => {
            this.inFlight--
            // a queued run is next: blank the bar until its first progress message
            this.progress = null
            this.currentPromptId = null
            this.st.preview.clearLatent()
            if (this.inFlight === 0) host.onLatentPreview = null
         })
      }
   }

   /** the server runs prompts one at a time: a NEW promptId = the next queued run just started */
   private onProgress(p: ExecutionProgress): void {
      if (p.promptId !== this.currentPromptId) {
         this.currentPromptId = p.promptId
         this.notice = null
         // stale latents from the previous run must not linger over the new one
         this.st.preview.clearLatent()
      }
      this.progress = p
   }

   randomizeSeedAndRun(): void {
      for (const [, varDef] of this.st.entries) {
         // kind-narrowing cast sanctioned (agent/coding.md)
         if (varDef.kind === 'seed') (varDef as SeedVar).randomize()
      }
      void this.run()
   }

   /** 'o': real pixels in the OS viewer — the in-terminal ceiling is half-blocks */
   openLastOutput(): void {
      const last = this.outputs[this.outputs.length - 1]
      if (last == null) {
         this.notice = 'no output image yet'
         return
      }
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
      const proc = spawn(cmd, [last], { stdio: 'ignore', detached: true })
      proc.on('error', () => {
         runInAction(() => {
            this.notice = `could not launch ${cmd}`
         })
      })
      proc.unref()
      this.notice = `opened ${basename(last)}`
   }

   // ---- clipboard ----
   private toClipboard(text: string): Promise<boolean> {
      const [cmd, ...args] =
         process.platform === 'darwin'
            ? ['pbcopy']
            : process.platform === 'win32'
              ? ['clip']
              : ['xclip', '-selection', 'clipboard']
      return new Promise((resolve) => {
         const proc = spawn(cmd ?? 'pbcopy', args, { stdio: ['pipe', 'ignore', 'ignore'] })
         proc.on('error', () => resolve(false))
         proc.on('close', (code) => resolve(code === 0))
         proc.stdin.write(text)
         proc.stdin.end()
      })
   }

   /** 'c': copy workflow.json (litegraph, drag into the ComfyUI editor) */
   async copyWorkflowJson(): Promise<void> {
      try {
         const wf = await this.st.wf.build()
         const json = await wf.toWorkflowJson()
         const ok = await this.toClipboard(JSON.stringify(json, null, 2))
         runInAction(() => {
            this.notice = ok ? `workflow.json copied (${json.nodes.length} nodes)` : 'clipboard copy failed'
         })
      } catch (e) {
         runInAction(() => {
            this.notice = `${extractErrorMessage(e)}`
         })
      }
   }

   /** 'C': copy api.json (the POST /prompt payload) */
   async copyApiJson(): Promise<void> {
      try {
         const wf = await this.st.wf.build()
         const json = wf.toApiJson('use_stringified_numbers_only')
         const ok = await this.toClipboard(JSON.stringify(json, null, 2))
         runInAction(() => {
            this.notice = ok ? `api.json copied (${Object.keys(json).length} nodes)` : 'clipboard copy failed'
         })
      } catch (e) {
         runInAction(() => {
            this.notice = `${extractErrorMessage(e)}`
         })
      }
   }
}
