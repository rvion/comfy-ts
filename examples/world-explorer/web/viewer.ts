import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark'
import { reaction } from 'mobx'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { View, WorldSt } from './state.ts'

// the three.js side: one renderer, one camera, a scene per view of the world, each loaded the first time its tab shows
// and kept while the world stays. The camera is read from the state every frame, so a key from the other side of a
// change turns this one too. Conventions of the files (agent/examples.md, world-explorer):
// - panorama.png: equirectangular, drawn inside a sphere around the eye
// - world.glb: the eye at the origin, y up, drawn unlit (its texture IS the light)
// - splat.ply: SHARP Gaussians in OpenCV axes (y down, z forward), turned half a turn around x

const FOV = 75
/** SHARP's own camera, when the ply names none */
const SPLAT_FOV = 50
const WALK_SPEED = 1.5

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

   constructor(
      private st: WorldSt,
      private host: HTMLElement,
      private onDrawn: (view: View) => void,
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
      let drag: { x: number; y: number } | null = null
      el.tabIndex = 0
      el.addEventListener('pointerdown', (e) => {
         drag = { x: e.clientX, y: e.clientY }
         el.setPointerCapture(e.pointerId)
         el.style.cursor = 'grabbing'
         el.focus()
      })
      el.addEventListener('pointermove', (e) => {
         if (drag == null) return
         this.st.turn(e.clientX - drag.x, e.clientY - drag.y, el.clientHeight, this.camera.fov)
         drag = { x: e.clientX, y: e.clientY }
      })
      const end = (): void => {
         drag = null
         el.style.cursor = ''
      }
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
      el.addEventListener(
         'wheel',
         (e) => {
            e.preventDefault()
            this.st.zoomBy(Math.exp(-e.deltaY * 0.0015))
         },
         { passive: false },
      )
      const walkKey = (k: string): boolean => /^(w|a|s|d|z|q|arrowup|arrowdown|arrowleft|arrowright)$/.test(k)
      window.addEventListener('keydown', (e) => {
         const k = e.key.toLowerCase()
         if (this.st.shown !== 'world' || !walkKey(k) || e.altKey || e.metaKey || e.ctrlKey) return
         e.preventDefault()
         this.keys.add(k)
      })
      window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
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
      if (view === 'world' && this.keys.size > 0) {
         const k = this.keys
         const f = (k.has('w') || k.has('z') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0)
         const r =
            (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('q') || k.has('arrowleft') ? 1 : 0)
         if (f !== 0 || r !== 0) this.st.walk(f * WALK_SPEED * dt, r * WALK_SPEED * dt)
      }
      const c = this.st.cam
      const cam = this.camera
      const fov = loaded.fov / c.zoom
      if (cam.fov !== fov) {
         cam.fov = fov
         cam.updateProjectionMatrix()
      }
      if (view === 'splat') {
         // an orbit around the median depth, in front of the eye along -z
         const d = loaded.depth
         cam.position.set(
            d * Math.sin(c.yaw) * Math.cos(c.pitch),
            d * Math.sin(c.pitch),
            -d + d * Math.cos(c.yaw) * Math.cos(c.pitch),
         )
         cam.up.set(0, 1, 0)
         cam.lookAt(0, 0, -d)
      } else {
         cam.position.set(view === 'world' ? c.x : 0, 0, view === 'world' ? c.z : 0)
         cam.rotation.set(c.pitch, c.yaw, 0, 'YXZ')
      }
      this.renderer.render(loaded.scene, cam)
      if (++this.frames === 3) this.onDrawn(view!)
   }

   stop(): void {
      this.stopReaction()
      this.renderer.setAnimationLoop(null)
   }
}
