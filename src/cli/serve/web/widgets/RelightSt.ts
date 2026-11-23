// the relight widget's state: the light, the motes, the view. One instance per widget on screen
// (component tier: created by the view, disposed with it). Time drives the orbit and the motes, so
// `at(t)` draws any instant: the video capture steps it frame by frame.
import { makeAutoObservable } from 'mobx'
import { MAX_MOTES, type RelightParams, type RelightView } from 'src/cli/serve/web/widgets/relightGl.ts'

/** a deterministic 0..1 per (mote, salt): the motes keep their paths across frames */
function hash(i: number, salt: number): number {
   const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
   return x - Math.floor(x)
}

function hexToRgb(hex: string): [number, number, number] {
   const n = Number.parseInt(hex.replace('#', ''), 16)
   if (Number.isNaN(n)) return [1, 1, 1]
   return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export class RelightSt {
   lightX = 0.3
   lightY = 0.3
   /** above the surface, in image heights */
   lightZ = 0.35
   color = '#ffd9a8'
   intensity = 1.7
   falloff = 0.45
   ambient = 0.4
   depthScale = 0.35
   exposure = 1.0
   shadows = true
   orbit = false
   particles = false
   moteCount = 10
   showLights = true
   view: RelightView = 'lit'
   /** seconds, advanced by the animation loop or set by `at(t)` */
   time = 0
   /** every map of the run is on the GPU: nothing is drawn before */
   ready = false

   constructor() {
      makeAutoObservable(this)
   }

   get animating(): boolean {
      return this.orbit || this.particles
   }

   /** the light where the orbit puts it at `time`, else where the pointer left it */
   get light(): [number, number, number] {
      if (!this.orbit) return [this.lightX, this.lightY, this.lightZ]
      const a = this.time * 0.9
      return [0.5 + Math.cos(a) * 0.34, 0.45 + Math.sin(a) * 0.28, this.lightZ]
   }

   get motes(): [number, number, number][] {
      if (!this.particles) return []
      const out: [number, number, number][] = []
      const n = Math.min(MAX_MOTES, this.moteCount)
      for (let i = 0; i < n; i++) {
         const speed = 0.15 + hash(i, 1) * 0.35
         const ph = hash(i, 2) * Math.PI * 2
         const t = this.time * speed + ph
         out.push([
            0.08 + 0.84 * (0.5 + 0.5 * Math.sin(t * 1.3 + hash(i, 3) * 6)),
            0.08 + 0.84 * (0.5 + 0.5 * Math.cos(t * 0.9 + hash(i, 4) * 6)),
            0.06 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.1 + hash(i, 5) * 6)),
         ])
      }
      return out
   }

   get params(): RelightParams {
      return {
         light: this.light,
         color: hexToRgb(this.color),
         intensity: this.intensity,
         falloff: this.falloff,
         ambient: this.ambient,
         depthScale: this.depthScale,
         shadows: this.shadows,
         motes: this.motes,
         moteIntensity: this.intensity * 0.18,
         showLights: this.showLights,
         view: this.view,
         exposure: this.exposure,
      }
   }

   /** the pointer put the light here (0..1 over the image); stops the orbit */
   moveLight(x: number, y: number): void {
      this.orbit = false
      this.lightX = Math.min(1, Math.max(0, x))
      this.lightY = Math.min(1, Math.max(0, y))
   }

   /** the wheel: nearer or farther from the surface */
   nudgeHeight(delta: number): void {
      this.lightZ = Math.min(1.5, Math.max(0.02, this.lightZ * (delta > 0 ? 1.1 : 1 / 1.1)))
   }

   tick(dt: number): void {
      this.time += dt
   }

   at(t: number): void {
      this.time = t
   }

   set<K extends keyof this & string>(k: K, value: this[K]): void {
      this[k] = value
   }
}
