// a CPU gaussian splat rasterizer (EWA: each gaussian a projected ellipse, sorted near to far, blended front to back)
// with the three maps the grow loop needs from one camera: color, coverage (alpha) and depth in metres.
// axes are SHARP's (OpenCV): x right, y down, z forward; a pose is camera to world
import { F, STRIDE, type Splat, type SplatCamera } from './ply.ts'

export type Vec3 = [number, number, number]
/** a 3x3 matrix, row major */
export type Mat3 = [number, number, number, number, number, number, number, number, number]
/** where a camera stands (C) and how it is turned (R: its x, y, z axes as the columns, in world axes) */
export type Pose = { R: Mat3; C: Vec3 }

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul3(a: Mat3, b: Mat3): Mat3 {
   const o: number[] = []
   for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) o.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!)
   return o as Mat3
}

export function transpose3(a: Mat3): Mat3 {
   return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
   return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
   ]
}

/** the turn of a camera: yaw to its left (degrees, about the down axis), then pitch up */
export function turn(yawLeft: number, pitchUp = 0): Mat3 {
   const y = (yawLeft * Math.PI) / 180
   const p = (pitchUp * Math.PI) / 180
   const yaw: Mat3 = [Math.cos(y), 0, -Math.sin(y), 0, 1, 0, Math.sin(y), 0, Math.cos(y)]
   const pitch: Mat3 = [1, 0, 0, 0, Math.cos(p), -Math.sin(p), 0, Math.sin(p), Math.cos(p)]
   return mul3(yaw, pitch)
}

export function quatToMat(w: number, x: number, y: number, z: number): Mat3 {
   const n = Math.hypot(w, x, y, z) || 1
   w /= n
   x /= n
   y /= n
   z /= n
   return [
      1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
      2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
      2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
   ]
}

export function matToQuat(m: Mat3): [number, number, number, number] {
   const t = m[0] + m[4] + m[8]
   if (t > 0) {
      const s = Math.sqrt(t + 1) * 2
      return [0.25 * s, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s]
   }
   if (m[0] > m[4] && m[0] > m[8]) {
      const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2
      return [(m[7] - m[5]) / s, 0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s]
   }
   if (m[4] > m[8]) {
      const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2
      return [(m[2] - m[6]) / s, (m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s]
   }
   const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2
   return [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s]
}

const SH_C0 = 0.28209479177387814

export type Render = {
   width: number
   height: number
   /** rgb 0..1 over black, 3 floats a pixel */
   color: Float32Array
   /** how much of each pixel the gaussians cover, 0..1 */
   alpha: Float32Array
   /** the blended distance along the camera's z, metres; 0 where nothing is */
   depth: Float32Array
}

export type RenderOptions = {
   /** gaussians nearer than this to the camera plane are skipped (metres) */
   near?: number
   /** an ellipse never reaches past this many pixels from its centre */
   maxRadius?: number
   /** rgb 0..1 a gaussian, in place of its sh dc colour (a view dependent colour evaluated for this camera) */
   colors?: Float32Array
}

export function render(s: Splat, cam: SplatCamera, pose: Pose, o: RenderOptions = {}): Render {
   const W = cam.width
   const H = cam.height
   const near = o.near ?? 0.05
   const maxRadius = o.maxRadius ?? 400
   const toCam = transpose3(pose.R)
   const d = s.data
   // the projected ellipses, kept for the visible ones only
   const u0 = new Float32Array(s.n)
   const v0 = new Float32Array(s.n)
   const depthOf = new Float32Array(s.n)
   const conic = new Float32Array(s.n * 3)
   const radius = new Uint16Array(s.n)
   const visible: number[] = []
   for (let g = 0; g < s.n; g++) {
      const b = g * STRIDE
      const px = d[b]! - pose.C[0]
      const py = d[b + 1]! - pose.C[1]
      const pz = d[b + 2]! - pose.C[2]
      const x = toCam[0] * px + toCam[1] * py + toCam[2] * pz
      const y = toCam[3] * px + toCam[4] * py + toCam[5] * pz
      const z = toCam[6] * px + toCam[7] * py + toCam[8] * pz
      if (z < near) continue
      const u = (cam.f * x) / z + cam.cx
      const v = (cam.f * y) / z + cam.cy
      // M = toCam · Rg · diag(scale); the camera covariance is M Mᵀ, the image one J M (J M)ᵀ
      const rg = quatToMat(d[b + F.rot]!, d[b + F.rot + 1]!, d[b + F.rot + 2]!, d[b + F.rot + 3]!)
      const sx = Math.exp(d[b + F.scale]!)
      const sy = Math.exp(d[b + F.scale + 1]!)
      const sz = Math.exp(d[b + F.scale + 2]!)
      const m = mul3(toCam, rg)
      const fz = cam.f / z
      const fxz = (cam.f * x) / (z * z)
      const fyz = (cam.f * y) / (z * z)
      // rows of J M, each column scaled by its axis' size
      const a0 = (fz * m[0] - fxz * m[6]) * sx
      const a1 = (fz * m[1] - fxz * m[7]) * sy
      const a2 = (fz * m[2] - fxz * m[8]) * sz
      const c0 = (fz * m[3] - fyz * m[6]) * sx
      const c1 = (fz * m[4] - fyz * m[7]) * sy
      const c2 = (fz * m[5] - fyz * m[8]) * sz
      // the 0.3 px² low pass of the 3DGS rasterizer: no ellipse thinner than a pixel
      const sxx = a0 * a0 + a1 * a1 + a2 * a2 + 0.3
      const sxy = a0 * c0 + a1 * c1 + a2 * c2
      const syy = c0 * c0 + c1 * c1 + c2 * c2 + 0.3
      const det = sxx * syy - sxy * sxy
      if (det <= 0) continue
      const mid = 0.5 * (sxx + syy)
      const lmax = mid + Math.sqrt(Math.max(0.1, mid * mid - det))
      const r = Math.min(maxRadius, Math.ceil(3 * Math.sqrt(lmax)))
      if (u + r < 0 || u - r >= W || v + r < 0 || v - r >= H) continue
      u0[g] = u
      v0[g] = v
      depthOf[g] = z
      conic[g * 3] = syy / det
      conic[g * 3 + 1] = -sxy / det
      conic[g * 3 + 2] = sxx / det
      radius[g] = r
      visible.push(g)
   }
   visible.sort((a, b) => depthOf[a]! - depthOf[b]!)

   const color = new Float32Array(W * H * 3)
   const T = new Float32Array(W * H).fill(1)
   const depthSum = new Float32Array(W * H)
   for (const g of visible) {
      const b = g * STRIDE
      const op = 1 / (1 + Math.exp(-d[b + F.opacity]!))
      if (op < 1 / 255) continue
      const cr = o.colors != null ? o.colors[g * 3]! : Math.min(1, Math.max(0, 0.5 + SH_C0 * d[b + F.dc]!))
      const cg = o.colors != null ? o.colors[g * 3 + 1]! : Math.min(1, Math.max(0, 0.5 + SH_C0 * d[b + F.dc + 1]!))
      const cb = o.colors != null ? o.colors[g * 3 + 2]! : Math.min(1, Math.max(0, 0.5 + SH_C0 * d[b + F.dc + 2]!))
      const u = u0[g]!
      const v = v0[g]!
      const z = depthOf[g]!
      const ca = conic[g * 3]!
      const cbc = conic[g * 3 + 1]!
      const cc = conic[g * 3 + 2]!
      const r = radius[g]!
      const xa = Math.max(0, Math.floor(u - r))
      const xb = Math.min(W - 1, Math.ceil(u + r))
      const ya = Math.max(0, Math.floor(v - r))
      const yb = Math.min(H - 1, Math.ceil(v + r))
      for (let py = ya; py <= yb; py++) {
         const dy = py + 0.5 - v
         const row = py * W
         for (let px = xa; px <= xb; px++) {
            const i = row + px
            const t = T[i]!
            if (t < 1e-4) continue
            const dx = px + 0.5 - u
            const power = -0.5 * (ca * dx * dx + cc * dy * dy) - cbc * dx * dy
            if (power > 0 || power < -4.5) continue
            const al = Math.min(0.99, op * Math.exp(power))
            if (al < 1 / 255) continue
            const w = t * al
            color[i * 3] = color[i * 3]! + w * cr
            color[i * 3 + 1] = color[i * 3 + 1]! + w * cg
            color[i * 3 + 2] = color[i * 3 + 2]! + w * cb
            depthSum[i] = depthSum[i]! + w * z
            T[i] = t * (1 - al)
         }
      }
   }
   const alpha = new Float32Array(W * H)
   const depth = new Float32Array(W * H)
   for (let i = 0; i < W * H; i++) {
      const a = 1 - T[i]!
      alpha[i] = a
      depth[i] = a > 1e-3 ? depthSum[i]! / a : 0
   }
   return { width: W, height: H, color, alpha, depth }
}
