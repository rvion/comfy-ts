import { makeAutoObservable, runInAction } from 'mobx'
import { CAM0, camOf, camText, type Cam } from 'rvlib-shipkit/src/view3d/cam.ts'

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

/** the keys posted at most this often while he moves: the other side follows, the hub is not flooded */
const POST_MS = 40

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
      const cam = camText(this.cam)
      if (cam !== '') q.set('cam', cam)
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
      this.cam = camOf(q.get('cam'))
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

   /** his move in the viewer: the eye as it is now, posted with the other keys */
   setCam(c: Cam): void {
      this.cam = c
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
      return camText(this.cam) !== ''
   }

   setLoading(what: string | null): void {
      this.loading = what
   }

   setError(e: string | null): void {
      this.error = e
   }
}
