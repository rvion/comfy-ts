// place a splat lifted from one filled view into the world: fit its scale on the pixels the world already
// covers, keep only the gaussians that land in the hole, move them from the view's camera to world axes
import { F, STRIDE, type Splat, type SplatCamera } from './ply.ts'
import { IDENTITY, matToQuat, render, type Pose, type Render } from './raster.ts'

type Quat = [number, number, number, number]

function quatMul(a: Quat, b: Quat): Quat {
   return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
   ]
}

function quantile(sorted: Float64Array, q: number): number {
   if (sorted.length === 0) return Number.NaN
   return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? Number.NaN
}

export type ScaleFit = {
   /** world metres per lifted metre */
   scale: number
   /** the 25 % and 75 % quantiles of the per pixel ratio: how much the two depths disagree in shape */
   spread: [number, number]
   /** how many pixels the fit used */
   pixels: number
}

/** the scale that best maps the lifted depth onto the world's depth, on pixels both cover well (median of ratios) */
export function fitScale(world: Render, lifted: Render, minCover = 0.95): ScaleFit {
   const logs: number[] = []
   for (let i = 0; i < world.alpha.length; i++) {
      if (world.alpha[i]! < minCover || lifted.alpha[i]! < minCover) continue
      const a = world.depth[i]!
      const b = lifted.depth[i]!
      if (a > 0 && b > 0) logs.push(Math.log(a / b))
   }
   if (logs.length < 1000) throw new Error(`scale fit: only ${logs.length} pixels covered by both splats, the views do not overlap enough`)
   const sorted = Float64Array.from(logs).sort()
   return {
      scale: Math.exp(quantile(sorted, 0.5)),
      spread: [Math.exp(quantile(sorted, 0.25)), Math.exp(quantile(sorted, 0.75))],
      pixels: logs.length,
   }
}

export type Placed = { kept: Splat; fit: ScaleFit; total: number }

/**
 * `lifted` is SHARP's splat of the filled view, in that view's camera axes; `world` is the render of the grown
 * splat from the same pose. Its gaussians whose centre lands where the world covered less than `keepBelow` are kept,
 * scaled by the fit, and moved to world axes.
 */
export function place(p: { lifted: Splat; world: Render; cam: SplatCamera; pose: Pose; keepBelow: number; minCover?: number }): Placed {
   const lc = p.lifted.camera
   if (lc == null) throw new Error('place: the lifted splat has no camera (intrinsic, image_size): not a SHARP ply')
   if (Math.abs(lc.f - p.cam.f) > 0.01 * p.cam.f || lc.width !== p.cam.width || lc.height !== p.cam.height)
      throw new Error(`place: the lifted splat was made for f=${lc.f} ${lc.width}x${lc.height}, the view is f=${p.cam.f} ${p.cam.width}x${p.cam.height}`)
   const liftedView = render(p.lifted, p.cam, { R: IDENTITY, C: [0, 0, 0] })
   const fit = fitScale(p.world, liftedView, p.minCover)
   const s = fit.scale
   const logS = Math.log(s)
   const R = p.pose.R
   const qR = matToQuat(R)
   const src = p.lifted.data
   const keep: number[] = []
   const W = p.cam.width
   const H = p.cam.height
   for (let g = 0; g < p.lifted.n; g++) {
      const b = g * STRIDE
      const z = src[b + 2]!
      if (z <= 0) continue
      const u = Math.floor((p.cam.f * src[b]!) / z + p.cam.cx)
      const v = Math.floor((p.cam.f * src[b + 1]!) / z + p.cam.cy)
      if (u < 0 || v < 0 || u >= W || v >= H) continue
      if (p.world.alpha[v * W + u]! < p.keepBelow) keep.push(g)
   }
   const data = new Float32Array(keep.length * STRIDE)
   keep.forEach((g, k) => {
      const b = g * STRIDE
      const o = k * STRIDE
      const x = src[b]! * s
      const y = src[b + 1]! * s
      const z = src[b + 2]! * s
      data[o] = R[0] * x + R[1] * y + R[2] * z + p.pose.C[0]
      data[o + 1] = R[3] * x + R[4] * y + R[5] * z + p.pose.C[1]
      data[o + 2] = R[6] * x + R[7] * y + R[8] * z + p.pose.C[2]
      for (let c = 0; c < 3; c++) data[o + F.dc + c] = src[b + F.dc + c]!
      data[o + F.opacity] = src[b + F.opacity]!
      for (let c = 0; c < 3; c++) data[o + F.scale + c] = src[b + F.scale + c]! + logS
      const q = quatMul(qR, [src[b + F.rot]!, src[b + F.rot + 1]!, src[b + F.rot + 2]!, src[b + F.rot + 3]!])
      for (let c = 0; c < 4; c++) data[o + F.rot + c] = q[c]!
   })
   return { kept: { n: keep.length, data, camera: null }, fit, total: p.lifted.n }
}
