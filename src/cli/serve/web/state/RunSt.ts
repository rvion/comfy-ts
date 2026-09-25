// the run QUEUE + results. Clicking generate repeatedly enqueues; the drainer
// sends ONE prompt at a time so anything still pending can be dropped before it
// ever reaches the host: queued prompts must be clearable, singly or
// all). Progress + latent preview are polled ~700ms while a prompt is in flight
import { makeAutoObservable, observableShallow, runInAction } from 'mobx'
import {
   deleteKeptResults,
   fetchKeptResults,
   fetchRunStatus,
   postGenerate,
   type GenerateOk,
   type MemoryUsage,
} from 'src/cli/serve/web/api.ts'
import { mergeKept } from 'src/cli/serve/web/state/keptResults.ts'
import { logWebError } from 'src/cli/serve/web/logWeb.ts'

export type RunResult = GenerateOk & { at: string }

function asRunResult(r: GenerateOk): RunResult {
   return { ...r, at: new Date(r.finishedAt ?? Date.now()).toLocaleTimeString() }
}

/** one enqueued prompt. `sent` marks the one on the host — that one is past cancelling */
export type QueueEntry = {
   id: string
   module: string
   draft: string
   payload: Record<string, unknown>
   sent: boolean
}

function sleep(ms: number): Promise<void> {
   return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RunSt {
   queue: QueueEntry[] = []
   error: string | null = null
   results: RunResult[] = []
   /** the serve process's unsaved outputs against its budget. null = not read yet */
   memory: MemoryUsage | null = null
   progressPercent: number | null = null
   /** what the host is doing right now, in the node's own unit — `TextGenerate 427/1024`.
    * A text graph has no latent preview and no image, so this is all there is to watch */
   progressNode: string | null = null
   progressCount: { value: number; max: number } | null = null
   /** what a streaming node has produced SO FAR — replacement semantics, newest wins */
   progressText: string | null = null
   hasPreview = false
   /** the server's frame seq — the <img> cache-buster, changes only on a NEW frame */
   previewTick = 0
   private draining = false
   private nextId = 0
   /** staleness guard for the poll loop (mobx-mechanics: counters, not flags) */
   private pollGen = 0

   /** what a finished run's seeds should do to the form. Set by WebSt: RunSt owns the queue,
    * not the draft */
   onSeeds: ((p: { module: string; draft: string; seeds: Record<string, number> }) => void) | null = null

   constructor() {
      makeAutoObservable(this, { queue: observableShallow, results: observableShallow })
   }

   get isRunning(): boolean {
      return this.queue.some((e) => e.sent)
   }

   /** the module whose prompt is on the host — the running card must not follow the selection */
   get runningModule(): string | null {
      return this.queue.find((e) => e.sent)?.module ?? null
   }

   get pendingCount(): number {
      return this.queue.filter((e) => !e.sent).length
   }

   enqueue(p: { module: string; draft: string; payload: Record<string, unknown> }): void {
      this.queue = [...this.queue, { id: `q${this.nextId++}`, ...p, sent: false }]
      this.error = null
      if (!this.draining) void this.drain()
   }

   /** drop a prompt that has not been sent yet; the one in flight is past cancelling */
   removeQueued(id: string): void {
      this.queue = this.queue.filter((e) => e.id !== id || e.sent)
   }

   dismissError(): void {
      this.error = null
   }

   clearQueue(): void {
      this.queue = this.queue.filter((e) => e.sent)
   }

   /** the server forgets it too: a reload must not bring back what was removed */
   remove(promptId: string): void {
      this.results = this.results.filter((r) => r.promptId !== promptId)
      void this.forget({ promptId })
   }

   clear(): void {
      this.results = []
      void this.forget({})
   }

   /** what the serve process kept: the last runs survive a page reload */
   async loadKept(): Promise<void> {
      try {
         const kept = await fetchKeptResults()
         runInAction(() => {
            this.results = mergeKept(this.results, kept.runs.map(asRunResult))
            this.memory = kept.memory
         })
      } catch (e) {
         logWebError('could not read the kept results', e)
      }
   }

   async refreshMemory(): Promise<void> {
      try {
         const kept = await fetchKeptResults()
         runInAction(() => {
            this.memory = kept.memory
         })
      } catch (e) {
         logWebError('could not read the memory usage', e)
      }
   }

   private async forget(p: { promptId?: string }): Promise<void> {
      try {
         const reply = await deleteKeptResults(p)
         runInAction(() => {
            this.memory = reply.memory
         })
      } catch (e) {
         logWebError('could not delete the kept result', e)
      }
   }

   /** one prompt at a time: a queued entry stays cancellable until its turn comes */
   private async drain(): Promise<void> {
      if (this.draining) return
      this.draining = true
      try {
         while (true) {
            const next = this.queue.find((e) => !e.sent)
            if (next == null) return
            runInAction(() => {
               // replace-by-copy keeps the one array idiom of this store
               this.queue = this.queue.map((e) => (e.id === next.id ? { ...e, sent: true } : e))
               this.progressPercent = null
               this.progressNode = null
               this.progressCount = null
               this.progressText = null
               this.hasPreview = false
            })
            const gen = ++this.pollGen
            void this.poll(next.module, gen)
            try {
               const result = await postGenerate(next)
               runInAction(() => {
                  // capped like the server's list: full-size <img>s per run would eat the tab
                  this.results = mergeKept([asRunResult(result)], this.results)
               })
               void this.refreshMemory()
               // named, because the panel may be on another draft by the time this resolves
               this.onSeeds?.({ module: next.module, draft: next.draft, seeds: result.seeds })
            } catch (e) {
               runInAction(() => {
                  this.error = e instanceof Error ? e.message : String(e)
                  // a failed prompt must not drag its queue down with it: drop the rest,
                  // loud in the run bar, rather than replay N doomed prompts
                  this.queue = this.queue.filter((entry) => entry.sent && entry.id !== next.id)
               })
            } finally {
               this.pollGen++
               runInAction(() => {
                  this.queue = this.queue.filter((e) => e.id !== next.id)
                  this.progressPercent = null
                  this.progressNode = null
                  this.progressCount = null
                  this.progressText = null
                  this.hasPreview = false
               })
            }
         }
      } finally {
         this.draining = false
      }
   }

   private async poll(module: string, gen: number): Promise<void> {
      while (gen === this.pollGen) {
         await sleep(700)
         if (gen !== this.pollGen) return
         try {
            const status = await fetchRunStatus({ module })
            runInAction(() => {
               if (gen !== this.pollGen) return
               this.progressPercent = status.percent
               this.progressNode = status.node ?? null
               this.progressCount = status.nodeProgress ?? null
               this.progressText = status.progressText ?? null
               this.hasPreview = status.hasPreview
               this.previewTick = status.previewSeq ?? 0
            })
         } catch {
            // a missed poll is not an incident; the POST's own error is the loud path
         }
      }
   }
}
