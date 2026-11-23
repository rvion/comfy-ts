import { makeAutoObservable, runInAction } from 'mobx'

// the page's state: which world, which of its files, the tab, the camera. Its keys (agent/examples.md, world-explorer):
// `key` the world, `view` the tab, `cam` the camera; framed by the hub, `state` is the url of a version's side and
// `view` + `cam` are what a before and an after share, so both sides switch tab and turn together

export const VIEWS = ['pano', 'world', 'splat', 'source'] as const
export type View = (typeof VIEWS)[number]

/** the file each view draws */
export const FILE_OF: Record<View, string> = {
   pano: 'panorama.png',
   world: 'world.glb',
   splat: 'splat.ply',
   source: 'source.png',
}

export type WorldFile = { name: string; v: string }
export type WorldInfo = { name: string; files: WorldFile[]; splatFov: number | null }

/** the eye: where it looks (yaw, pitch in radians, three's YXZ order), its zoom (the fov divided by it), where it
 *  stands (x, y, z) and how far ahead its orbit's center is (dist, 0 = the view's own: a splat's median depth) */
export type Cam = { yaw: number; pitch: number; zoom: number; x: number; y: number; z: number; dist: number }
export const CAM0: Cam = { yaw: 0, pitch: 0, zoom: 1, x: 0, y: 0, z: 0, dist: 0 }
const CAM_KEYS = ['yaw', 'pitch', 'zoom', 'x', 'y', 'z', 'dist'] as const

/** a move of the camera, the drag's or the wheel's: what it does depends on the view */
export type Gesture = 'turn' | 'pan'

/** the keys posted at most this often while he moves: the other side follows, the hub is not flooded */
const POST_MS = 40

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const r3 = (v: number): string => String(Math.round(v * 1000) / 1000)

/** where the eye looks, its right and its up, for a yaw and a pitch in three's YXZ order */
export function axes(c: Pick<Cam, 'yaw' | 'pitch'>): {
   fwd: [number, number, number]
   right: [number, number, number]
   up: [number, number, number]
} {
   const sy = Math.sin(c.yaw)
   const cy = Math.cos(c.yaw)
   const sp = Math.sin(c.pitch)
   const cp = Math.cos(c.pitch)
   return { fwd: [-sy * cp, sp, -cy * cp], right: [cy, 0, -sy], up: [sy * sp, cp, cy * sp] }
}

export class WorldSt {
   name = ''
   side = ''
   /** how the hub frames the page: `thumb` for the still it shoots (no ui), `lightbox` (the hub closes it), else inline or alone */
   mode: '' | 'thumb' | 'lightbox' = ''
   /** the files the shown version names: a side's state, else every file the world has on disk */
   wanted: string[] = []
   all: WorldInfo[] = []
   view: View | null = null
   cam: Cam = { ...CAM0 }
   error: string | null = null
   /** what loads now and how far, for the one line */
   loading: string | null = null
   private stateUrl = ''

   constructor(private post: (keys: string) => void) {
      makeAutoObservable<WorldSt, 'post' | 'postTimer' | 'postedAt'>(this, {
         post: false,
         postTimer: false,
         postedAt: false,
      })
   }

   get info(): WorldInfo | null {
      return this.all.find((w) => w.name === this.name) ?? null
   }

   get views(): View[] {
      const info = this.info
      if (info == null) return []
      return VIEWS.filter((v) => this.wanted.includes(FILE_OF[v]) && info.files.some((f) => f.name === FILE_OF[v]))
   }

   /** the tab drawn: the one asked when the world has it, else the first */
   get shown(): View | null {
      const vs = this.views
      return this.view != null && vs.includes(this.view) ? this.view : (vs[0] ?? null)
   }

   /** the view a thumbnail shows: the world's first, at the default camera */
   get thumbView(): View | null {
      return this.views[0] ?? null
   }

   /** the page makes the thumbnail when the world has none, or when its keys say `thumb=again` */
   thumbAgain = false

   get wantsThumb(): boolean {
      const info = this.info
      return info != null && (this.thumbAgain || !info.files.some((f) => f.name === 'thumb.webp'))
   }

   /** the thumbnail sent: the world lists it now, so no other frame sends one */
   thumbSent(): void {
      this.thumbAgain = false
      const info = this.info
      if (info != null && !info.files.some((f) => f.name === 'thumb.webp'))
         info.files.push({ name: 'thumb.webp', v: 'new' })
   }

   /** a world file by its relative path, under its stamp so the browser keeps it */
   fileUrl(view: View): string | null {
      const f = this.info?.files.find((x) => x.name === FILE_OF[view])
      return f == null ? null : `worlds/${this.name}/${f.name}?v=${f.v}`
   }

   get keys(): string {
      const q = new URLSearchParams()
      if (this.name !== '') q.set('key', this.name)
      if (this.view != null) q.set('view', this.view)
      const c = this.cam
      if (CAM_KEYS.some((k) => c[k] !== CAM0[k])) q.set('cam', CAM_KEYS.map((k) => r3(c[k])).join(','))
      return q.toString().replaceAll('%2C', ',')
   }

   /** the keys from the hub or the address: they never post back, only a move of his does */
   fromKeys(keys: string): void {
      const q = new URLSearchParams(keys)
      this.side = q.get('side') ?? ''
      const mode = q.get('mode')
      this.mode = mode === 'thumb' || mode === 'lightbox' ? mode : ''
      const view = q.get('view')
      this.view = VIEWS.find((v) => v === view) ?? null
      const n = (q.get('cam') ?? '').split(',').map(Number)
      const cam = { ...CAM0 }
      CAM_KEYS.forEach((k, i) => {
         const v = n[i]
         if (q.has('cam') && v !== undefined && Number.isFinite(v)) cam[k] = v
      })
      this.cam = cam
      this.thumbAgain = q.get('thumb') === 'again'
      const state = q.get('state') ?? ''
      if (state !== '' && state !== this.stateUrl) void this.loadState(state)
      else if (state === '') {
         this.name = q.get('key') ?? ''
         this.wanted = Object.values(FILE_OF)
      }
   }

   async boot(): Promise<void> {
      try {
         const r = await fetch('api/worlds')
         if (!r.ok) throw new Error(`api/worlds: ${r.status}`)
         const all = (await r.json()) as WorldInfo[]
         runInAction(() => (this.all = all))
      } catch (e) {
         runInAction(() => (this.error = (e as Error).message))
      }
   }

   private async loadState(url: string): Promise<void> {
      this.stateUrl = url
      try {
         const r = await fetch(url)
         if (!r.ok) throw new Error(`the version's state: ${r.status} ${await r.text()}`)
         const s = (await r.json()) as { json?: { name?: unknown; files?: unknown } }
         const name = s.json?.name
         const files = s.json?.files
         if (typeof name !== 'string') throw new Error('the version names no world')
         runInAction(() => {
            this.name = name
            this.wanted = Array.isArray(files)
               ? files.filter((f): f is string => typeof f === 'string')
               : Object.values(FILE_OF)
            this.error = null
         })
      } catch (e) {
         runInAction(() => (this.error = (e as Error).message))
      }
   }

   /** standalone: every file of the world on disk */
   get standalone(): boolean {
      return this.stateUrl === ''
   }

   setView(v: View): void {
      if (v === this.shown) return
      this.view = v
      this.cam = { ...CAM0 }
      this.moved()
   }

   /** the median depth of the splat shown, set by the viewer once it loaded: the orbit's center by default */
   depth = 6

   setDepth(d: number): void {
      this.depth = d
   }

   /** how far ahead the eye's orbit center is: a splat's own depth, else 2 m */
   get dist(): number {
      return this.cam.dist > 0 ? this.cam.dist : this.shown === 'splat' ? this.depth : 2
   }

   /** the scale of a move: a splat's depth, a mesh's meter */
   get scale(): number {
      return this.shown === 'splat' ? this.depth : 1
   }

   reset(): void {
      this.cam = { ...CAM0 }
      this.moved()
   }

   /** a drag of dx, dy pixels over a stage h pixels high, at a vertical fov of fovDeg. `turn`: the pano and the mesh
    *  look around the eye, the splat orbits around the point ahead. `pan`: the eye and that point move together */
   drag(g: Gesture, dx: number, dy: number, h: number, fovDeg: number): void {
      const c = this.cam
      const k = (fovDeg * Math.PI) / 180 / Math.max(1, h)
      if (this.shown === 'pano' || (g === 'turn' && this.shown === 'world')) {
         c.yaw += dx * k
         c.pitch = clamp(c.pitch + dy * k, -1.5, 1.5)
      } else if (g === 'turn') {
         const d = this.dist
         const before = axes(c).fwd
         const t = [c.x + before[0] * d, c.y + before[1] * d, c.z + before[2] * d]
         c.yaw -= dx * k
         c.pitch = clamp(c.pitch - dy * k, -1.5, 1.5)
         const f = axes(c).fwd
         c.x = t[0]! - f[0] * d
         c.y = t[1]! - f[1] * d
         c.z = t[2]! - f[2] * d
      } else {
         // the point ahead follows the pointer
         const s = (2 * this.dist * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, h)
         const a = axes(c)
         c.x += (-dx * a.right[0] + dy * a.up[0]) * s
         c.y += (-dx * a.right[1] + dy * a.up[1]) * s
         c.z += (-dx * a.right[2] + dy * a.up[2]) * s
      }
      this.moved()
   }

   /** forward (and back with a negative step), in the view's scale: the pano zooms instead */
   dolly(step: number): void {
      const c = this.cam
      if (this.shown === 'pano') {
         c.zoom = clamp(c.zoom * Math.exp(step), 0.6, 4)
         return this.moved()
      }
      const m = step * this.scale
      const f = axes(c).fwd
      c.x += f[0] * m
      c.y += f[1] * m
      c.z += f[2] * m
      if (this.shown === 'splat') c.dist = Math.max(0.05 * this.depth, this.dist - m)
      this.moved()
   }

   /** a step of the eye along where it looks (forward), to its right and up, in the view's scale; the mesh walks
    *  level, the splat flies */
   move(forward: number, right: number, up: number): void {
      if (this.shown === 'pano' || this.shown === 'source') return
      const c = this.cam
      const a = axes(this.shown === 'world' ? { yaw: c.yaw, pitch: 0 } : c)
      const s = this.scale
      c.x += (a.fwd[0] * forward + a.right[0] * right) * s
      c.y += (a.fwd[1] * forward + up) * s
      c.z += (a.fwd[2] * forward + a.right[2] * right) * s
      this.moved()
   }

   private postTimer: ReturnType<typeof setTimeout> | null = null
   private postedAt = 0

   /** his move: the keys go out now, or once the last post is POST_MS old */
   private moved(): void {
      const wait = this.postedAt + POST_MS - performance.now()
      if (wait <= 0) {
         this.postedAt = performance.now()
         this.post(this.keys)
         return
      }
      if (this.postTimer != null) return
      this.postTimer = setTimeout(() => {
         this.postTimer = null
         this.postedAt = performance.now()
         this.post(this.keys)
      }, wait)
   }

   /** the page fills the screen (the browser's fullscreen on its root): the lightbox */
   full = false
   /** a line that says what did not happen (a fullscreen the frame refused), gone after a few seconds */
   notice: string | null = null

   setFull(on: boolean): void {
      this.full = on
   }

   setNotice(n: string | null): void {
      this.notice = n
   }

   /** his first move hides the hint */
   get touched(): boolean {
      return CAM_KEYS.some((k) => this.cam[k] !== CAM0[k])
   }

   setLoading(what: string | null): void {
      this.loading = what
   }

   setError(e: string | null): void {
      this.error = e
   }
}
