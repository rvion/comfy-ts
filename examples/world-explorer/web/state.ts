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

export type Cam = { yaw: number; pitch: number; zoom: number; x: number; z: number }
export const CAM0: Cam = { yaw: 0, pitch: 0, zoom: 1, x: 0, z: 0 }

/** the splat opens holes once the eye leaves its camera by more than about 15% of its depth: the orbit's half angle */
export const SPLAT_ORBIT = 0.15
/** how far the eye walks from the mesh's center, in meters */
export const WALK_RADIUS = 3

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const r3 = (v: number): string => String(Math.round(v * 1000) / 1000)

export class WorldSt {
   name = ''
   side = ''
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
      makeAutoObservable<WorldSt, 'post'>(this, { post: false })
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
      if (c.yaw !== 0 || c.pitch !== 0 || c.zoom !== 1 || c.x !== 0 || c.z !== 0)
         q.set('cam', [c.yaw, c.pitch, c.zoom, ...(c.x !== 0 || c.z !== 0 ? [c.x, c.z] : [])].map(r3).join(','))
      return q.toString().replaceAll('%2C', ',')
   }

   /** the keys from the hub or the address: they never post back, only a move of his does */
   fromKeys(keys: string): void {
      const q = new URLSearchParams(keys)
      this.side = q.get('side') ?? ''
      const view = q.get('view')
      this.view = VIEWS.find((v) => v === view) ?? null
      const n = (q.get('cam') ?? '').split(',').map(Number)
      const at = (i: number, d: number): number =>
         Number.isFinite(n[i]) && q.has('cam') && n[i] !== undefined ? n[i] : d
      this.cam = { yaw: at(0, 0), pitch: at(1, 0), zoom: at(2, 1), x: at(3, 0), z: at(4, 0) }
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
      this.post(this.keys)
   }

   /** a drag of dx, dy pixels over a stage h pixels high, at a vertical fov of fovDeg */
   turn(dx: number, dy: number, h: number, fovDeg: number): void {
      const k = ((fovDeg * Math.PI) / 180 / Math.max(1, h)) * 1
      const c = this.cam
      if (this.shown === 'splat') {
         c.yaw = clamp(c.yaw - dx * k * 0.25, -SPLAT_ORBIT, SPLAT_ORBIT)
         c.pitch = clamp(c.pitch + dy * k * 0.25, -SPLAT_ORBIT * 0.7, SPLAT_ORBIT * 0.7)
      } else {
         c.yaw += dx * k
         c.pitch = clamp(c.pitch + dy * k, -1.45, 1.45)
      }
      this.post(this.keys)
   }

   zoomBy(f: number): void {
      const c = this.cam
      c.zoom = clamp(c.zoom * f, this.shown === 'splat' ? 0.8 : 0.6, 4)
      this.post(this.keys)
   }

   /** a step of the eye in the mesh: forward and right in meters, along where it looks */
   walk(forward: number, right: number): void {
      const c = this.cam
      const s = Math.sin(c.yaw)
      const co = Math.cos(c.yaw)
      let x = c.x - s * forward + co * right
      let z = c.z - co * forward - s * right
      const d = Math.hypot(x, z)
      if (d > WALK_RADIUS) {
         x *= WALK_RADIUS / d
         z *= WALK_RADIUS / d
      }
      c.x = x
      c.z = z
      this.post(this.keys)
   }

   setLoading(what: string | null): void {
      this.loading = what
   }

   setError(e: string | null): void {
      this.error = e
   }
}
