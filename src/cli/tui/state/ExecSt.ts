import { spawn } from 'node:child_process'
import { makeAutoObservable, runInAction } from 'mobx'
import { basename } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { ExecutionProgress } from 'src/runner/ComfyExecution.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { SeedVar } from 'src/vars/ComfyVars.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** popup body: summary + the head of the copied json (proof of WHAT is in the clipboard) */
export function jsonHead(text: string, maxLines: number): string[] {
   const lines = text.split('\n')
   const head = lines.slice(0, maxLines).map((l) => (l.length > 76 ? `${l.slice(0, 75)}…` : l))
   if (lines.length > maxLines) head.push('…')
   return head
}

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

   /** every host a latent-preview handler is installed on — a queued run may
    * target a DIFFERENT host after an `h` override switch, and clearing only
    * the last run's host would leak the handler on the first one */
   private latentHosts: Set<ComfyHost> = new Set()

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
      const host = this.st.runHost
      runInAction(() => {
         this.inFlight++
         this.error = null
         if (queued) {
            this.notice = `queued another run (server queue: ${this.st.queue.remaining + 1})`
         } else {
            this.progress = null
            this.notice = null
            this.currentPromptId = null
            // latents only: the LAST OUTPUT must survive the run start — the
            // 'latent small' / 'last output' preview settings show it while
            // running (full reset belongs to workflow switches)
            this.st.preview.clearLatent()
         }
         // installed while ANY run is in flight (queued prompts keep painting
         // latents), on THIS run's host — it may differ from the previous
         // run's after an `h` override switch
         host.onLatentPreview = (p) => void this.st.preview.renderLatent(p.bytes)
         this.latentHosts.add(host)
      })
      try {
         const execution = await this.st.wf.run({
            host: this.st.hostOverride ?? undefined,
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
            if (this.inFlight === 0) {
               for (const h of this.latentHosts) h.onLatentPreview = null
               this.latentHosts.clear()
            }
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

   /** `c`/`C` end HERE, success or failure — a copy must never be silent
    * (his repro: 'c does nothing', the notice line was too quiet) */
   copyPopup: { title: string; ok: boolean; lines: string[] } | null = null

   /** a copy build can hang on a stalled-host upload: guard double-presses */
   private copying = false

   closeCopyPopup(): void {
      this.copyPopup = null
      this.st.mode = 'nav'
   }

   private showCopyPopup(title: string, ok: boolean, lines: string[]): void {
      // the build is async: if the user moved into an editor meanwhile, never
      // steal their keys — degrade to the notice line instead of a popup
      const m = this.st.mode
      if (m === 'edit' || m.startsWith('overlay-')) {
         this.notice = `${ok ? '✓' : '✗'} ${title}`
         return
      }
      this.copyPopup = { title, ok, lines }
      this.st.mode = 'overlay-copy'
   }
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
      if (this.copying) return
      runInAction(() => {
         this.copying = true
         // instant feedback: the i2i upload inside build can hang for a tcp timeout
         this.notice = 'building for copy… (i2i workflows upload their input image first)'
      })
      try {
         const wf = await this.st.wf.build({ host: this.st.hostOverride ?? undefined })
         const json = await wf.toWorkflowJson()
         const text = JSON.stringify(json, null, 2)
         const ok = await this.toClipboard(text)
         runInAction(() => {
            this.showCopyPopup(
               'workflow.json → clipboard',
               ok,
               ok
                  ? [
                       `${json.nodes.length} nodes · ${text.length} chars — paste into the ComfyUI editor`,
                       '',
                       ...jsonHead(text, 10),
                    ]
                  : ['CLIPBOARD COPY FAILED — is a clipboard tool available (pbcopy/clip/xclip) ?'],
            )
         })
      } catch (e) {
         runInAction(() => {
            this.showCopyPopup('workflow.json copy FAILED', false, [
               extractErrorMessage(e),
               '',
               'nothing was copied. i2i/i2v builds upload their input image first —',
               'an unreachable host fails the build itself, not just the run.',
            ])
         })
      } finally {
         runInAction(() => {
            this.copying = false
         })
      }
   }

   /** 'C': copy api.json (the POST /prompt payload) */
   async copyApiJson(): Promise<void> {
      if (this.copying) return
      runInAction(() => {
         this.copying = true
         this.notice = 'building for copy… (i2i workflows upload their input image first)'
      })
      try {
         const wf = await this.st.wf.build({ host: this.st.hostOverride ?? undefined })
         const json = wf.toApiJson('use_stringified_numbers_only')
         const text = JSON.stringify(json, null, 2)
         const ok = await this.toClipboard(text)
         runInAction(() => {
            this.showCopyPopup(
               'api.json → clipboard',
               ok,
               ok
                  ? [
                       `${Object.keys(json).length} nodes · ${text.length} chars — the POST /prompt payload`,
                       '',
                       ...jsonHead(text, 10),
                    ]
                  : ['CLIPBOARD COPY FAILED — is a clipboard tool available (pbcopy/clip/xclip) ?'],
            )
         })
      } catch (e) {
         runInAction(() => {
            this.showCopyPopup('api.json copy FAILED', false, [
               extractErrorMessage(e),
               '',
               'nothing was copied. i2i/i2v builds upload their input image first —',
               'an unreachable host fails the build itself, not just the run.',
            ])
         })
      } finally {
         runInAction(() => {
            this.copying = false
         })
      }
   }
}
