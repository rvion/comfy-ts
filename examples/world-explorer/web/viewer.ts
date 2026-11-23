import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark'
import { reaction } from 'mobx'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Gesture, View, WorldSt } from './state.ts'
import { sendThumb } from './thumb.ts'

// the three.js side: one renderer, one camera, a scene per view of the world, each loaded the first time its tab shows
// and kept while the world stays. The camera is read from the state every frame, so a key from the other side of a
// change turns this one too. Conventions of the files (agent/examples.md, world-explorer):
// - panorama.png: equirectangular, drawn inside a sphere around the eye
// - world.glb: the eye at the origin, y up, drawn unlit (its texture IS the light)
// - splat.ply: SHARP Gaussians in OpenCV axes (y down, z forward), turned half a turn around x

const FOV = 75
/** SHARP's own camera, when the ply names none */
const SPLAT_FOV = 50
/** meters a second in the mesh, and in a splat's depths a second */
const WALK_SPEED = 1.5
const SPLAT_SPEED = 0.25
/** the frames drawn before the view counts as ready (the shot-ready mark, the thumbnail) */
const READY = 3
const READY_SPLAT = 60
/** how much a glide keeps of its speed every 16 ms, as the hub's panorama */
const GLIDE = 0.9
/** the keys that move the eye, by their place on the keyboard (an AZERTY's ZQSD is a QWERTY's WASD) */
const MOVE_KEYS = new Set([
   'KeyW',
   'KeyA',
   'KeyS',
   'KeyD',
   'KeyQ',
   'KeyE',
   'Space',
   'ArrowUp',
   'ArrowDown',
   'ArrowLeft',
   'ArrowRight',
])

type Loaded = { scene: THREE.Scene; fov: number; depth: number }

export class Viewer {
   readonly renderer: THREE.WebGLRenderer
   private camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 2000)
   private scenes = new Map<string, Loaded | 'loading'>()
   private spark: SparkRenderer
   private keys = new Set<string>()
   private last = performance.now()
   private running = true
   private frames = 0
   private stopReaction: () => void
   /** a click into the view makes the wheel its own, until the pointer leaves */
   private engaged = false
   private glide: { x: number; y: number; g: Gesture } | null = null
   private velocity: { x: number; y: number; g: Gesture } | null = null
   private lastMove = 0

   constructor(
      private st: WorldSt,
      private host: HTMLElement,
      private onDrawn: (view: View) => void,
      private onFullscreen: () => void,
   ) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true })
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
      this.renderer.setClearColor(0x0d0e10)
      host.appendChild(this.renderer.domElement)
      this.spark = new SparkRenderer({ renderer: this.renderer })
      new ResizeObserver(() => this.resize()).observe(host)
      this.resize()
      this.bindInput()
      this.stopReaction = reaction(
         () => [this.st.name, this.st.shown] as const,
         () => void this.ensure(),
         { fireImmediately: true },
      )
      this.renderer.setAnimationLoop(() => this.tick())
   }

   setRunning(on: boolean): void {
      this.running = on
      this.last = performance.now()
   }

   /** the vertical fov drawn now, in degrees */
   get fov(): number {
      return this.camera.fov
   }

   private resize(): void {
      const w = Math.max(1, this.host.clientWidth)
      const h = Math.max(1, this.host.clientHeight)
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
   }

   private sceneKey(view: View): string {
      return `${this.st.name}/${view}`
   }

   private async ensure(): Promise<void> {
      const view = this.st.shown
      if (view == null || view === 'source') return
      const url = this.st.fileUrl(view)
      const key = this.sceneKey(view)
      if (url == null || this.scenes.has(key)) return
      // a new world: the scenes of the last one go
      for (const [k, s] of this.scenes) if (!k.startsWith(`${this.st.name}/`) && s !== 'loading') this.dispose(s.scene)
      for (const k of [...this.scenes.keys()]) if (!k.startsWith(`${this.st.name}/`)) this.scenes.delete(k)
      this.scenes.set(key, 'loading')
      this.frames = 0
      try {
         const loaded =
            view === 'pano'
               ? await this.loadPano(url)
               : view === 'world'
                 ? await this.loadWorld(url)
                 : await this.loadSplat(url)
         this.scenes.set(key, loaded)
         this.st.setLoading(null)
         this.frames = 0
      } catch (e) {
         this.scenes.delete(key)
         this.st.setLoading(null)
         this.st.setError(`${view}: ${(e as Error).message}`)
      }
   }

   private progress(what: string): (e: ProgressEvent) => void {
      return (e) =>
         this.st.setLoading(
            e.lengthComputable && e.total > 0
               ? `${what} ${Math.round((100 * e.loaded) / e.total)}%`
               : `${what} ${(e.loaded / 1e6).toFixed(0)} MB`,
         )
   }

   private async loadPano(url: string): Promise<Loaded> {
      this.st.setLoading('panorama')
      const tex = await new THREE.TextureLoader().loadAsync(url)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      const geo = new THREE.SphereGeometry(100, 96, 48)
      // seen from inside: mirror it so the picture reads the right way round
      geo.scale(-1, 1, 1)
      const sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }))
      // the picture's center ahead (-z), where the mesh made from the same panorama has it
      sphere.rotation.y = -Math.PI / 2
      const scene = new THREE.Scene()
      scene.add(sphere)
      return { scene, fov: FOV, depth: 0 }
   }

   private async loadWorld(url: string): Promise<Loaded> {
      this.st.setLoading('mesh')
      const gltf = await new GLTFLoader().loadAsync(url, this.progress('mesh'))
      gltf.scene.traverse((o) => {
         if (!(o instanceof THREE.Mesh)) return
         const old = o.material as THREE.MeshStandardMaterial
         o.material = new THREE.MeshBasicMaterial({ map: old.map, side: THREE.DoubleSide })
         old.dispose()
      })
      const scene = new THREE.Scene()
      scene.add(gltf.scene)
      return { scene, fov: FOV, depth: 0 }
   }

   private async loadSplat(url: string): Promise<Loaded> {
      this.st.setLoading('splat')
      const mesh = new SplatMesh({ url, fileType: SplatFileType.PLY, onProgress: this.progress('splat') })
      mesh.quaternion.set(1, 0, 0, 0)
      await mesh.initialized
      // the orbit's center: the median depth of the splats, measured on one in sixteen
      const zs: number[] = []
      mesh.forEachSplat((i: number, center: THREE.Vector3) => {
         if ((i & 15) === 0) zs.push(center.z)
      })
      zs.sort((a, b) => a - b)
      const depth = zs[zs.length >> 1] ?? 6
      const scene = new THREE.Scene()
      scene.add(this.spark)
      scene.add(mesh)
      this.st.setDepth(depth > 0 ? depth : 6)
      return { scene, fov: this.st.info?.splatFov ?? SPLAT_FOV, depth: depth > 0 ? depth : 6 }
   }

   private dispose(scene: THREE.Scene): void {
      scene.traverse((o) => {
         if (o instanceof SplatMesh) o.dispose()
         else if (o instanceof THREE.Mesh) {
            o.geometry.dispose()
            const m = o.material as THREE.MeshBasicMaterial
            m.map?.dispose()
            m.dispose()
         }
      })
   }

   private bindInput(): void {
      const el = this.host
      el.tabIndex = 0
      const ptrs = new Map<number, { x: number; y: number }>()
      let gesture: Gesture = 'turn'
      // a two finger touch: its midpoint pans, its spread goes forward
      let pinch: { x: number; y: number; d: number } | null = null
      const mid = (): { x: number; y: number; d: number } => {
         const [a, b] = [...ptrs.values()]
         if (a == null || b == null) return { x: 0, y: 0, d: 0 }
         return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }
      }
      el.addEventListener('contextmenu', (e) => e.preventDefault())
      el.addEventListener('pointerdown', (e) => {
         if ((e.target as HTMLElement).closest('button') != null) return
         ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
         el.setPointerCapture(e.pointerId)
         gesture = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'turn'
         pinch = ptrs.size === 2 ? mid() : null
         this.glide = null
         this.engaged = true
         el.style.cursor = gesture === 'pan' ? 'move' : 'grabbing'
         el.focus()
      })
      el.addEventListener('pointermove', (e) => {
         const p = ptrs.get(e.pointerId)
         if (p == null) return
         const dx = e.clientX - p.x
         const dy = e.clientY - p.y
         p.x = e.clientX
         p.y = e.clientY
         if (pinch != null && ptrs.size === 2) {
            const m = mid()
            this.st.drag('pan', m.x - pinch.x, m.y - pinch.y, el.clientHeight, this.camera.fov)
            if (pinch.d > 0 && m.d > 0) this.st.dolly(Math.log(m.d / pinch.d))
            pinch = m
            return
         }
         this.st.drag(gesture, dx, dy, el.clientHeight, this.camera.fov)
         const now = performance.now()
         const dt = Math.max(1, now - this.lastMove)
         this.lastMove = now
         this.velocity = { x: dx / dt, y: dy / dt, g: gesture }
      })
      const end = (e: PointerEvent): void => {
         ptrs.delete(e.pointerId)
         pinch = null
         if (ptrs.size > 0) return
         el.style.cursor = ''
         // a release while still moving glides on, as the hub's panorama does
         const v = this.velocity
         if (v != null && performance.now() - this.lastMove < 60 && Math.hypot(v.x, v.y) > 0.05) this.glide = { ...v }
         this.velocity = null
      }
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
      el.addEventListener('pointerleave', () => {
         if (ptrs.size === 0 && document.fullscreenElement == null) this.engaged = false
      })
      el.addEventListener('dblclick', () => this.st.reset())
      el.addEventListener(
         'wheel',
         (e) => {
            // a trackpad's pinch reaches the page as a wheel with ctrl held: always his. Anything else only once he
            // clicked into the view or opened it full screen, so a world in a thread never traps the page's scroll
            if (!e.ctrlKey && !this.engaged && document.fullscreenElement == null) return
            e.preventDefault()
            this.glide = null
            const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
            const dx = e.deltaX * px
            const dy = e.deltaY * px
            if (e.ctrlKey) return this.st.dolly(-dy * 0.01)
            // a trackpad's two finger drag: small steps, often sideways; a mouse wheel: big notches, straight
            const trackpad = dx !== 0 || (Math.abs(dy) < 40 && e.deltaMode === 0)
            if (trackpad && this.st.shown !== 'pano') this.st.drag('pan', -dx, -dy, el.clientHeight, this.camera.fov)
            else if (trackpad) this.st.drag('turn', -dx, -dy, el.clientHeight, this.camera.fov)
            else this.st.dolly(-dy * 0.0015)
         },
         { passive: false },
      )
      window.addEventListener('keydown', (e) => {
         if (e.altKey || e.metaKey || e.ctrlKey) return
         if (e.code === 'KeyR') {
            this.glide = null
            return this.st.reset()
         }
         if (e.code === 'KeyF') return this.onFullscreen()
         if (!MOVE_KEYS.has(e.code) || this.st.shown === 'pano' || this.st.shown === 'source') return
         e.preventDefault()
         this.keys.add(e.code)
      })
      window.addEventListener('keyup', (e) => this.keys.delete(e.code))
      window.addEventListener('blur', () => this.keys.clear())
   }

   private tick(): void {
      const now = performance.now()
      const dt = Math.min(0.1, (now - this.last) / 1000)
      this.last = now
      if (!this.running || document.hidden) return
      const view = this.st.shown
      const loaded = view == null ? undefined : this.scenes.get(this.sceneKey(view))
      if (loaded == null || loaded === 'loading') return
      if (this.keys.size > 0) {
         const k = this.keys
         const on = (...codes: string[]): number => (codes.some((c) => k.has(c)) ? 1 : 0)
         const f = on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown')
         const r = on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft')
         const u = on('KeyE', 'Space') - on('KeyQ')
         const speed = view === 'splat' ? SPLAT_SPEED : WALK_SPEED
         if (f !== 0 || r !== 0 || u !== 0) this.st.move(f * speed * dt, r * speed * dt, u * speed * dt)
      }
      const g = this.glide
      if (g != null) {
         const ms = dt * 1000
         this.st.drag(g.g, g.x * ms, g.y * ms, this.host.clientHeight, this.camera.fov)
         const keep = Math.pow(GLIDE, ms / 16)
         g.x *= keep
         g.y *= keep
         if (Math.hypot(g.x, g.y) < 0.01) this.glide = null
      }
      const c = this.st.cam
      const cam = this.camera
      const fov = loaded.fov / c.zoom
      if (cam.fov !== fov) {
         cam.fov = fov
         cam.updateProjectionMatrix()
      }
      if (view === 'pano') cam.position.set(0, 0, 0)
      else cam.position.set(c.x, c.y, c.z)
      cam.rotation.set(c.pitch, c.yaw, 0, 'YXZ')
      this.renderer.render(loaded.scene, cam)
      // a splat sorts its Gaussians in a worker: the first frames may still draw an older order
      if (++this.frames === (view === 'splat' ? READY_SPLAT : READY)) {
         this.onDrawn(view!)
         if (this.st.wantsThumb && view === this.st.thumbView && !this.st.touched) {
            const c = this.renderer.domElement
            const name = this.st.name
            this.st.thumbSent()
            sendThumb(name, c, c.width, c.height).catch((e: unknown) => this.st.setNotice((e as Error).message))
         }
      }
   }

   stop(): void {
      this.stopReaction()
      this.renderer.setAnimationLoop(null)
   }
}
