// the one state tree of the page: the catalog, the source image, one result per (image, scale,
// model), and ONE view (centre and zoom) shared by every picture that shows a result: the loupe's
// tiles and both sides of a compared pair show the same crop at the same zoom.
import { makeAutoObservable, runInAction } from 'mobx'
import {
   fetchCatalog,
   RunQueue,
   sampleBlob,
   uploadSource,
   type CardInfo,
   type RunSt,
   type Source,
} from '../../explorer-kit/web/runs.ts'

export type ModelInfo = CardInfo & {
   kind: 'baseline' | 'model' | 'diffusion'
   tier: 'modern' | 'classic'
   arch: string
   native: number
   license: string
}
export type Scale = 2 | 4
export type Layout = 'grid' | 'loupe'
export type CompareMode = 'side' | 'swipe' | 'onion' | 'mod' | 'diff'
export const COMPARE_MODES: readonly CompareMode[] = ['side', 'swipe', 'onion', 'mod', 'diff']
/** what a pair compares against when nothing else is picked: the source enlarged with no model */
export const BASELINE = 'lanczos'
/** the source as the browser scales it, before the Lanczos result is in */
export const SOURCE = 'source'

/** the centre of the view, 0..1 over the image, and its zoom: device pixels per image pixel
 * (1 = 100 %, each pixel of the result on one pixel of the screen); 'fit' = the whole image */
export type View = { cx: number; cy: number; z: number | 'fit' }

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
export const Z_MIN = 0.05
export const Z_MAX = 16

export class AppSt {
   host = ''
   models: ModelInfo[] = []
   samples: string[] = []
   loadError: string | null = null
   source: Source | null = null
   scale: Scale = 4
   showClassic = false
   showMissing = true
   layout: Layout = 'grid'
   view: View = { cx: 0.5, cy: 0.5, z: 1 }
   /** the loupe's tile edge, css px */
   tile = 360
   /** the compared pair: `after` set = the compare view is open */
   before = BASELINE
   after: string | null = null
   mode: CompareMode = 'side'
   opacity = 0.5
   split = 0.5
   runs = new RunQueue()
   /** a small picture of each finished result, for the grid: result key → object url */
   thumbs = new Map<string, string>()

   constructor() {
      makeAutoObservable<this, 'thumbing'>(this, { thumbs: true, thumbing: false })
   }

   async boot(): Promise<void> {
      try {
         const c = await fetchCatalog<ModelInfo>()
         runInAction(() => {
            this.host = c.host
            this.models = c.models
            this.samples = c.samples
         })
         // deep link: ?image=<sample>&scale=2|4&classic=1&run=all|<id,id>&layout=loupe&at=<cx>,<cy>&z=<zoom|fit>
         //            &compare=<after>&before=<id>&mode=side|swipe|onion|mod|diff
         const q = new URLSearchParams(location.search)
         if (q.get('scale') === '2') this.set('scale', 2)
         if (q.get('classic') === '1') this.set('showClassic', true)
         const pick = q.get('image')
         const first = (pick != null && c.samples.includes(pick) ? pick : null) ?? c.samples[0]
         if (first != null) await this.loadSample(first)
         const run = q.get('run')
         if (run === 'all') this.runAll()
         else if (run != null) for (const id of run.split(',')) if (this.model(id)?.ok === true) this.enqueue(id)
         const at = q.get('at')?.split(',').map(Number)
         const z = q.get('z')
         this.setView({
            cx: at?.[0] ?? this.view.cx,
            cy: at?.[1] ?? this.view.cy,
            z: z === 'fit' ? 'fit' : z != null ? Number(z) : this.view.z,
         })
         if (q.get('layout') === 'loupe') this.set('layout', 'loupe')
         const mode = COMPARE_MODES.find((m) => m === q.get('mode'))
         if (mode != null) this.setMode(mode)
         await this.settled()
         const after = q.get('compare')
         if (after != null) this.openPair(after, q.get('before') ?? undefined, z == null)
      } catch (e) {
         runInAction(() => (this.loadError = e instanceof Error ? e.message : String(e)))
      }
      // the shot service waits for this mark (sk shot): every queued run has ended
      document.querySelector('meta[name="shot-ready"]')?.setAttribute('content', 'ready')
   }

   get visibleModels(): ModelInfo[] {
      return this.models.filter((m) => (this.showClassic || m.tier === 'modern') && (this.showMissing || m.ok))
   }
   get runnable(): ModelInfo[] {
      return this.visibleModels.filter((m) => m.ok)
   }
   get busy(): boolean {
      return this.runs.busy
   }
   model(id: string): ModelInfo | undefined {
      return this.models.find((m) => m.id === id)
   }
   resultKey(model: string): string {
      return `${this.source?.key ?? '-'}:${this.scale}:${model}`
   }
   result(model: string): RunSt | undefined {
      return this.runs.get(this.resultKey(model))
   }
   /** the finished results of the visible models, in catalog order */
   get done(): ModelInfo[] {
      return this.visibleModels.filter((m) => this.result(m.id)?.status === 'done')
   }
   /** every pixel size the results share: the source times the scale */
   get outW(): number {
      return (this.source?.width ?? 0) * this.scale
   }
   get outH(): number {
      return (this.source?.height ?? 0) * this.scale
   }
   /** the picture of a compare side: a result, or the source scaled by the browser */
   urlOf(id: string): string | null {
      if (id === SOURCE) return this.source?.url ?? null
      const r = this.result(id)
      return r?.status === 'done' ? r.url : null
   }
   nameOf(id: string): string {
      if (id === SOURCE) return 'source (browser scaled)'
      const m = this.model(id)
      return m == null ? id : `${m.label} ${m.family}`
   }

   async loadSample(name: string): Promise<void> {
      await this.setSource(await sampleBlob(name), name)
   }

   async setSource(blob: Blob, name: string): Promise<void> {
      const source = await uploadSource(blob, name)
      runInAction(() => {
         this.source = source
         this.after = null
      })
   }

   enqueue(model: string): void {
      const src = this.source
      if (src == null) return
      const key = this.resultKey(model)
      this.runs.enqueue(key, { image: src.key, model, scale: this.scale }, () => {
         this.thumbing.push(this.makeThumb(key))
      })
   }

   runAll(): void {
      for (const m of this.runnable) if (this.result(m.id)?.status !== 'done') this.enqueue(m.id)
   }

   /** every queued run ended and its thumbnail is drawn */
   async settled(): Promise<void> {
      await this.runs.settled()
      await Promise.all(this.thumbing)
   }
   private thumbing: Promise<void>[] = []

   /** a 640 px wide copy of a finished result: the grid shows 20 of them at once, never the 12 MP files */
   private async makeThumb(key: string): Promise<void> {
      const r = this.runs.get(key)
      if (r?.url == null || this.thumbs.has(key)) return
      const blob = await (await fetch(r.url)).blob()
      const bmp = await createImageBitmap(blob, { resizeWidth: 640, resizeQuality: 'high' })
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d')?.drawImage(bmp, 0, 0)
      const small = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/webp', 0.9))
      if (small != null) runInAction(() => this.thumbs.set(key, URL.createObjectURL(small)))
   }
   thumb(model: string): string | null {
      return this.thumbs.get(this.resultKey(model)) ?? null
   }

   // ── the shared view ──
   setView(v: View): void {
      this.view = v.z === 'fit' ? v : { cx: clamp(v.cx, 0, 1), cy: clamp(v.cy, 0, 1), z: clamp(v.z, Z_MIN, Z_MAX) }
   }
   /** the zoom a frame of `fw` × `fh` css px shows, as device pixels per image pixel */
   zoomIn(fw: number, fh: number): number {
      if (this.view.z !== 'fit') return this.view.z
      if (this.outW === 0) return 1
      return Math.min(fw / this.outW, fh / this.outH) * devicePixelRatio
   }
   /** zoom by `k` around the point (px, py) of a frame of fw × fh css px: that pixel stays put */
   zoomAt(k: number, px: number, py: number, fw: number, fh: number): void {
      const z = this.zoomIn(fw, fh)
      const s = z / devicePixelRatio
      const W = this.outW
      const H = this.outH
      const cx = this.view.z === 'fit' ? 0.5 : this.view.cx
      const cy = this.view.z === 'fit' ? 0.5 : this.view.cy
      const u = cx + (px - fw / 2) / (W * s)
      const v = cy + (py - fh / 2) / (H * s)
      const z2 = clamp(z * k, Z_MIN, Z_MAX)
      const s2 = z2 / devicePixelRatio
      this.setView({ cx: u - (px - fw / 2) / (W * s2), cy: v - (py - fh / 2) / (H * s2), z: z2 })
   }
   /** move the view by a drag of dx, dy css px */
   pan(dx: number, dy: number, fw: number, fh: number): void {
      const s = this.zoomIn(fw, fh) / devicePixelRatio
      const cx = this.view.z === 'fit' ? 0.5 : this.view.cx
      const cy = this.view.z === 'fit' ? 0.5 : this.view.cy
      this.setView({ cx: cx - dx / (this.outW * s), cy: cy - dy / (this.outH * s), z: this.zoomIn(fw, fh) })
   }
   /** the last frame a viewport measured, css px: + and − from 'fit' start at its fit zoom */
   frame = { w: 0, h: 0 }
   noteFrame(w: number, h: number): void {
      this.frame = { w, h }
   }
   /** + / − keys and buttons: around the centre */
   step(k: number): void {
      const z = this.zoomIn(this.frame.w, this.frame.h)
      const centred = this.view.z === 'fit' ? { cx: 0.5, cy: 0.5 } : this.view
      this.setView({ ...centred, z: z * k })
   }
   fit(): void {
      this.setView({ cx: 0.5, cy: 0.5, z: 'fit' })
   }
   actual(): void {
      const centred = this.view.z === 'fit' ? { cx: 0.5, cy: 0.5 } : this.view
      this.setView({ ...centred, z: 1 })
   }

   // ── the compared pair ──
   /** open the pair view on `after`, against `before` (else the Lanczos baseline, else the source);
    * `at`: the point of the image the click landed on, which the view centres at 100 % */
   openPair(after: string, before?: string, fit = false, at?: { u: number; v: number }): void {
      this.after = after
      const fallback = this.urlOf(BASELINE) != null && after !== BASELINE ? BASELINE : SOURCE
      this.before = before != null && this.urlOf(before) != null ? before : fallback
      if (at != null) this.setView({ cx: at.u, cy: at.v, z: 1 })
      else if (fit) this.fit()
   }
   closePair(): void {
      this.after = null
   }
   setMode(m: CompareMode): void {
      this.mode = m
   }
   /** D cycles the modes, ⇧D goes back */
   cycleMode(step: 1 | -1): void {
      const i = COMPARE_MODES.indexOf(this.mode)
      this.mode = COMPARE_MODES[(i + step + COMPARE_MODES.length) % COMPARE_MODES.length] ?? 'side'
   }
   swapPair(): void {
      if (this.after == null) return
      const a = this.after
      this.after = this.before
      this.before = a
   }

   set<K extends 'scale' | 'showClassic' | 'showMissing' | 'layout' | 'tile' | 'before' | 'after' | 'opacity' | 'split'>(
      k: K,
      v: this[K],
   ): void {
      this[k] = v
   }
}
