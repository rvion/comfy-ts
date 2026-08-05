// query-shaped run state: one generate in flight at a time (the server
// serializes per module anyway), results newest first
import { makeAutoObservable, observableShallow, runInAction } from 'mobx'
import { postGenerate, type GenerateOk } from 'src/cli/serve/web/api.ts'

export type RunResult = GenerateOk & { at: string }

export class RunSt {
   isRunning = false
   error: string | null = null
   results: RunResult[] = []

   constructor() {
      makeAutoObservable(this, { results: observableShallow })
   }

   async generate(p: { module: string; draft: string; payload: Record<string, unknown> }): Promise<void> {
      if (this.isRunning) return
      this.isRunning = true
      this.error = null
      try {
         const result = await postGenerate(p)
         runInAction(() => {
            this.results.unshift({ ...result, at: new Date().toLocaleTimeString() })
            // full-size <img>s per run: an unbounded session would eat the tab
            if (this.results.length > 20) this.results.length = 20
         })
      } catch (e) {
         runInAction(() => {
            this.error = e instanceof Error ? e.message : String(e)
         })
      } finally {
         runInAction(() => {
            this.isRunning = false
         })
      }
   }
}
