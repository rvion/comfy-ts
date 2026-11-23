// the one state tree of the page: the catalog from the server, the source image, one result per
// (image, detail, model), the view settings. A sequential run queue: one prompt at a time on the GPU.
import { makeAutoObservable, runInAction } from 'mobx'

export type WeightFile = { node: string; input: string; file: string; folder: string; url: string }
export type ModelInfo = {
   id: string
   label: string
   family: string
   year: number
   kind: 'depth' | 'normal'
   tier: 'modern' | 'classic'
   blurb: string
   autoDownload: boolean
   ok: boolean
   missingNodes: string[]
   missingFiles: WeightFile[]
}
export type Source = { key: string; url: string; name: string; width: number; height: number }
export type Colormap = 'gray' | 'turbo'
export type FocusView = 'wipe' | '3d' | 'light'

export class ResultSt {
   status: 'queued' | 'running' | 'done' | 'error' = 'queued'
   url: string | null = null
   ms: number | null = null
   error: string | null = null
   startedAt = 0
   constructor() {
      makeAutoObservable(this)
   }
}

export class AppSt {
   host = ''
   models: ModelInfo[] = []
   samples: string[] = []
   loadError: string | null = null
   source: Source | null = null
   detail = 768
   showClassic = false
   showMissing = true
   colormap: Colormap = 'turbo'
   autoLevels = true
   focus: string | null = null
   focusView: FocusView = 'wipe'
   /** the left side of the wipe: 'source' or a model id */
   wipeAgainst = 'source'
   results = new Map<string, ResultSt>()
   private queue: { key: string; model: string; image: string; detail: number }[] = []
   private draining = false
   /** ticks every 200 ms while something runs, for the elapsed timers */
   now = Date.now()

   constructor() {
      makeAutoObservable(this, { results: true })
      setInterval(() => runInAction(() => (this.now = Date.now())), 200)
   }

   async boot(): Promise<void> {
      try {
         const [m, s] = await Promise.all([fetch('/api/models'), fetch('/api/samples')])
         const mj = (await m.json()) as { host: string; models: ModelInfo[] }
         const sj = (await s.json()) as string[]
         runInAction(() => {
            this.host = mj.host
            this.models = mj.models
            this.samples = sj
         })
         // deep link: ?image=<sample>&run=all|<id,id>&focus=<id>&view=wipe|3d|light
         const q = new URLSearchParams(location.search)
         const pick = q.get('image')
         const first =
            (pick != null && sj.includes(pick) ? pick : null) ?? sj.find((x) => x.startsWith('lioness')) ?? sj[0]
         if (first != null) await this.loadSample(first)
         const run = q.get('run')
         if (run === 'all') this.runAll()
         else if (run != null) for (const id of run.split(',')) if (this.model(id)?.ok === true) this.enqueue(id)
         const focus = q.get('focus')
         const view = q.get('view')
         if (focus != null) {
            await this.settled()
            this.openFocus(focus)
            if (view === 'wipe' || view === '3d' || view === 'light') this.set('focusView', view)
         }
      } catch (e) {
         runInAction(() => (this.loadError = e instanceof Error ? e.message : String(e)))
      }
   }

   get visibleModels(): ModelInfo[] {
      return this.models.filter((m) => (this.showClassic || m.tier === 'modern') && (this.showMissing || m.ok))
   }
   get depthModels(): ModelInfo[] {
      return this.visibleModels.filter((m) => m.kind === 'depth')
   }
   get normalModels(): ModelInfo[] {
      return this.visibleModels.filter((m) => m.kind === 'normal')
   }
   get runnable(): ModelInfo[] {
      return this.visibleModels.filter((m) => m.ok)
   }
   get busy(): boolean {
      return this.queue.length > 0 || this.draining
   }

   model(id: string): ModelInfo | undefined {
      return this.models.find((m) => m.id === id)
   }
   resultKey(model: string): string {
      return `${this.source?.key ?? '-'}:${this.detail}:${model}`
   }
   result(model: string): ResultSt | undefined {
      return this.results.get(this.resultKey(model))
   }
   get doneModels(): ModelInfo[] {
      return this.models.filter((m) => this.result(m.id)?.status === 'done')
   }

   async loadSample(name: string): Promise<void> {
      const blob = await (await fetch(`/api/samples/${encodeURIComponent(name)}`)).blob()
      await this.setSource(blob, name)
   }

   async setSource(blob: Blob, name: string): Promise<void> {
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.src = url
      await img.decode()
      const res = await fetch('/api/image', { method: 'POST', body: blob })
      const j = (await res.json()) as { key?: string; error?: string }
      if (j.key == null) throw new Error(j.error ?? 'upload failed')
      const key = j.key
      runInAction(() => {
         this.source = { key, url, name, width: img.naturalWidth, height: img.naturalHeight }
         this.focus = null
      })
   }

   enqueue(model: string): void {
      const src = this.source
      if (src == null) return
      const key = this.resultKey(model)
      const prev = this.results.get(key)
      if (prev != null && (prev.status === 'queued' || prev.status === 'running')) return
      this.results.set(key, new ResultSt())
      this.queue.push({ key, model, image: src.key, detail: this.detail })
      void this.drain()
   }

   runAll(): void {
      for (const m of this.runnable) if (this.result(m.id)?.status !== 'done') this.enqueue(m.id)
   }

   /** resolves once the run queue is empty */
   settled(): Promise<void> {
      return new Promise((resolve) => {
         const tick = (): void => {
            if (this.busy) setTimeout(tick, 100)
            else resolve()
         }
         tick()
      })
   }

   private async drain(): Promise<void> {
      if (this.draining) return
      this.draining = true
      try {
         for (;;) {
            const job = this.queue.shift()
            if (job == null) break
            const r = this.results.get(job.key)
            if (r == null) continue
            runInAction(() => {
               r.status = 'running'
               r.startedAt = Date.now()
            })
            try {
               const res = await fetch('/api/run', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ image: job.image, model: job.model, detail: job.detail }),
               })
               if (!res.ok) {
                  const j = (await res.json()) as { error?: string }
                  throw new Error(j.error ?? `http ${res.status}`)
               }
               const url = URL.createObjectURL(await res.blob())
               const ms = Number(res.headers.get('x-ms'))
               runInAction(() => {
                  r.url = url
                  r.ms = ms
                  r.status = 'done'
               })
            } catch (e) {
               runInAction(() => {
                  r.error = e instanceof Error ? e.message : String(e)
                  r.status = 'error'
               })
            }
         }
      } finally {
         runInAction(() => (this.draining = false))
      }
   }

   openFocus(model: string): void {
      const m = this.model(model)
      this.focus = model
      if (m?.kind === 'normal' && this.focusView === '3d') this.focusView = 'light'
      if (m?.kind === 'depth' && this.focusView === 'light') this.focusView = '3d'
   }

   set<K extends 'detail' | 'showClassic' | 'showMissing' | 'colormap' | 'autoLevels' | 'focusView' | 'wipeAgainst'>(
      k: K,
      v: this[K],
   ): void {
      this[k] = v
   }

   closeFocus(): void {
      this.focus = null
   }
}
