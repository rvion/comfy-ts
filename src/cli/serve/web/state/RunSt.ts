// query-shaped run state: one generate in flight at a time (the server
// serializes per module anyway), results newest first, and a ~700ms poll of
// /run/<module> while running (progress percent + latent preview tick)
import { makeAutoObservable, observableShallow, runInAction } from 'mobx'
import { fetchRunStatus, postGenerate, type GenerateOk } from 'src/cli/serve/web/api.ts'

export type RunResult = GenerateOk & { at: string }

function sleep(ms: number): Promise<void> {
   return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RunSt {
   isRunning = false
   error: string | null = null
   results: RunResult[] = []
   progressPercent: number | null = null
   hasPreview = false
   /** bumped per poll that saw a preview — the <img> cache-buster */
   previewTick = 0
   /** staleness guard for the poll loop (mobx-mechanics: counters, not flags) */
   private pollGen = 0

   constructor() {
      makeAutoObservable(this, { results: observableShallow })
   }

   remove(promptId: string): void {
      this.results = this.results.filter((r) => r.promptId !== promptId)
   }

   clear(): void {
      this.results = []
   }

   async generate(p: { module: string; draft: string; payload: Record<string, unknown> }): Promise<void> {
      if (this.isRunning) return
      const gen = ++this.pollGen
      this.isRunning = true
      this.error = null
      this.progressPercent = null
      this.hasPreview = false
      void this.poll(p.module, gen)
      try {
         const result = await postGenerate(p)
         runInAction(() => {
            if (gen !== this.pollGen) return
            // replace-by-copy, the one array idiom here (remove/clear do the same);
            // capped: full-size <img>s per run would eat the tab
            this.results = [{ ...result, at: new Date().toLocaleTimeString() }, ...this.results].slice(0, 20)
         })
      } catch (e) {
         runInAction(() => {
            if (gen === this.pollGen) this.error = e instanceof Error ? e.message : String(e)
         })
      } finally {
         runInAction(() => {
            if (gen === this.pollGen) {
               this.isRunning = false
               this.progressPercent = null
            }
         })
      }
   }

   private async poll(module: string, gen: number): Promise<void> {
      while (gen === this.pollGen && this.isRunning) {
         await sleep(700)
         if (gen !== this.pollGen || !this.isRunning) return
         try {
            const status = await fetchRunStatus({ module })
            runInAction(() => {
               if (gen !== this.pollGen) return
               this.progressPercent = status.percent
               this.hasPreview = status.hasPreview
               if (status.hasPreview) this.previewTick++
            })
         } catch {
            // a missed poll is not an incident; the POST's own error is the loud path
         }
      }
   }
}
