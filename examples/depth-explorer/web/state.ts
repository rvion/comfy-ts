// the one state tree of the page: the catalog from the server, the source image, one result per
// (image, detail, model), the view settings. A sequential run queue: one prompt at a time on the GPU.
import { makeAutoObservable, runInAction } from 'mobx'

export type WeightFile = { node: string; input: string; file: string; folder: string; url: string }
export type ModelInfo = {
   id: string
   label: string
   family: string
   year: number
   kind: 'depth' | 'normal' | 'material'
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
   /** the wipe handle, 0..100 % of the width */
   wipeX = 50
   /** the 3D relief camera and surface */
   relief = { yaw: 0.35, pitch: 0.2, zoom: 1, depthScale: 0.3, shade: 0.6 }
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
         await this.settled()
         if (focus != null) {
            this.openFocus(focus)
            if (view === 'wipe' || view === '3d' || view === 'light') this.set('focusView', view)
         }
      } catch (e) {
         runInAction(() => (this.loadError = e instanceof Error ? e.message : String(e)))
      }
      // the shot service waits for this mark (sk shot): every queued run has ended
      document.querySelector('meta[name="shot-ready"]')?.setAttribute('content', 'ready')
   }

   /** the scripted tour a demo video steps through (`sk shot --step tour`), over finished results:
    * the grid, a wipe against the source then against another model, the 3D relief, a material
    * map, then the relight widget's own tour */
   async tour(t: number): Promise<void> {
      const main = document.querySelector('main')
      const wave = (a: number, b: number): number => Math.min(1, Math.max(0, (t - a) / (b - a)))
      if (t < 3) {
         this.closeFocus()
         if (main != null) main.scrollTop = wave(0.5, 3) * (main.scrollHeight - main.clientHeight)
         return
      }
      if (t < 10) {
         this.openFocus(this.firstDoneId('depth') ?? 'da3-mono-large')
         this.set('focusView', 'wipe')
         this.set('wipeAgainst', t < 6.5 ? 'source' : (this.firstDoneId('depth', 1) ?? 'source'))
         const k = t < 6.5 ? wave(3, 6.5) : wave(6.5, 10)
         this.set('wipeX', 50 + 42 * Math.sin(k * Math.PI * 2))
         return
      }
      if (t < 14) {
         this.openFocus(this.firstDoneId('depth') ?? 'da3-mono-large')
         this.set('focusView', '3d')
         this.set('relief', { ...this.relief, yaw: -0.75 + 1.5 * wave(10, 14), pitch: 0.45, depthScale: 0.5, zoom: 0.62 })
         return
      }
      if (t < 16.5) {
         this.openFocus('iid-albedo')
         this.set('focusView', 'wipe')
         this.set('wipeAgainst', 'source')
         this.set('wipeX', 85 - 70 * wave(14, 16.5))
         return
      }
      this.openFocus(this.firstDoneId('normal') ?? 'moge2-normal')
      this.set('focusView', 'light')
      // the widget mounts on this render, and registers its hook when it does
      for (let i = 0; i < 200 && typeof Reflect.get(window, 'relightTour') !== 'function'; i++)
         await new Promise((ok) => setTimeout(ok, 16))
      const f: unknown = Reflect.get(window, 'relightTour')
      if (typeof f === 'function') await f(t - 16.5)
   }

   /** the id of the `nth` finished modern result of a kind, in catalog order */
   firstDoneId(kind: ModelInfo['kind'], nth = 0): string | null {
      const done = this.models.filter(
         (m) => m.kind === kind && m.tier === 'modern' && this.result(m.id)?.status === 'done',
      )
      return done[nth]?.id ?? null
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
   get materialModels(): ModelInfo[] {
      return this.visibleModels.filter((m) => m.kind === 'material')
   }

   /** the url of the first finished result among `ids`, in that order of preference */
   firstDone(ids: string[]): string | null {
      for (const id of ids) {
         const url = this.result(id)?.url
         if (this.result(id)?.status === 'done' && url != null) return url
      }
      return null
   }

   /** every map the relight view can use for the focused model: the focus itself, the best
    * finished depth and normal of the grid, and the finished material maps */
   get relightMaps(): { tag: string; url: string }[] {
      const focus = this.focus != null ? this.model(this.focus) : undefined
      const src = this.source
      if (focus == null || src == null) return []
      const byKind = (kind: ModelInfo['kind']): string[] => [
         ...(focus.kind === kind ? [focus.id] : []),
         ...this.models.filter((m) => m.kind === kind && m.tier === 'modern').map((m) => m.id),
      ]
      const out: { tag: string; url: string }[] = [{ tag: 'source', url: src.url }]
      const add = (tag: string, url: string | null): void => {
         if (url != null) out.push({ tag, url })
      }
      add('depth', this.firstDone(byKind('depth')))
      add('normal', this.firstDone(byKind('normal')))
      add('albedo', this.firstDone(['iid-albedo', 'marigold2-albedo']))
      add('roughness', this.firstDone(['iid-roughness']))
      add('metalness', this.firstDone(['iid-metalness']))
      add('specular', this.firstDone(['iid-specular']))
      return out
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
      if (m?.kind === 'material') this.focusView = 'wipe'
   }

   set<
      K extends
         | 'detail'
         | 'showClassic'
         | 'showMissing'
         | 'colormap'
         | 'autoLevels'
         | 'focusView'
         | 'wipeAgainst'
         | 'wipeX'
         | 'relief',
   >(k: K, v: this[K]): void {
      this[k] = v
   }

   closeFocus(): void {
      this.focus = null
   }
}
