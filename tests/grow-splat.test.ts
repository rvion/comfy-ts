import { describe, expect, it } from 'bun:test'
import { place, trimToFrame } from 'examples/rvion/grow-splat/align.ts'
import { concatSplats, encodeSplat, parseSplat, STRIDE, type Splat, type SplatCamera } from 'examples/rvion/grow-splat/ply.ts'
import { IDENTITY, apply3, matToQuat, quatToMat, render, turn } from 'examples/rvion/grow-splat/raster.ts'

const CAM: SplatCamera = { f: 40, cx: 32, cy: 24, width: 64, height: 48 }

/** a wall of opaque gaussians facing the camera at depth z, covering x in [x0, x1] metres */
function wall(z: number, x0: number, x1: number, step = 0.05): Splat {
   const rows: number[] = []
   for (let x = x0; x <= x1 + 1e-9; x += step)
      for (let y = -0.8 * z; y <= 0.8 * z + 1e-9; y += step) rows.push(x, y, z, 1, 0, -1, 6, Math.log(step), Math.log(step), Math.log(step / 10), 1, 0, 0, 0)
   return { n: rows.length / STRIDE, data: Float32Array.from(rows), camera: CAM }
}

describe('grow splat: ply', () => {
   it('a splat and its camera survive a write and a read', () => {
      const s = wall(2, -0.2, 0.2)
      const back = parseSplat(encodeSplat(s))
      expect(back.n).toBe(s.n)
      expect(back.camera).toEqual(CAM)
      expect(Array.from(back.data)).toEqual(Array.from(s.data))
   })

   it('reads a vertex with other properties around the gaussian ones, and refuses a ply with none', () => {
      const head = 'ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float nx\n' + ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].map((f) => `property float ${f}\n`).join('') + 'property uchar red\nend_header\n'
      const body = new DataView(new ArrayBuffer(15 * 4 + 1))
      for (let i = 0; i < 15; i++) body.setFloat32(i * 4, i, true)
      const bytes = new Uint8Array([...Buffer.from(head, 'latin1'), ...new Uint8Array(body.buffer)])
      const s = parseSplat(bytes)
      expect(Array.from(s.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
      expect(s.camera).toBeNull()
      expect(() => parseSplat(Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex 0\nproperty float x\nend_header\n'))).toThrow(/no 'y'/)
   })

   it('concat keeps every gaussian and the first camera', () => {
      const a = wall(2, -0.2, 0)
      const b = { ...wall(3, 0, 0.2), camera: null }
      const c = concatSplats([a, b])
      expect(c.n).toBe(a.n + b.n)
      expect(c.camera).toEqual(CAM)
   })
})

describe('grow splat: raster', () => {
   it('a wall straight ahead covers the view at its depth; turned away, the view is empty', () => {
      const s = wall(2, -2, 2)
      const r = render(s, CAM, { R: IDENTITY, C: [0, 0, 0] })
      const mid = 24 * 64 + 32
      expect(r.alpha[mid]).toBeGreaterThan(0.99)
      expect(r.depth[mid]).toBeCloseTo(2, 2)
      const away = render(s, CAM, { R: turn(180), C: [0, 0, 0] })
      expect(Math.max(...away.alpha)).toBe(0)
   })

   it('turning left shows the wall on the right of the picture', () => {
      const s = wall(2, -0.3, 0.3)
      const r = render(s, CAM, { R: turn(20), C: [0, 0, 0] })
      const col = (x: number) => r.alpha[24 * 64 + x]!
      expect(col(50)).toBeGreaterThan(0.9)
      expect(col(10)).toBe(0)
   })

   it('quaternions go to matrices and back', () => {
      const R = turn(35, 20)
      const q = matToQuat(R)
      const back = quatToMat(q[0], q[1], q[2], q[3])
      back.forEach((v, i) => expect(v).toBeCloseTo(R[i]!, 6))
      const v = apply3(R, [0, 0, 1])
      expect(v[0]).toBeLessThan(0)
      expect(v[1]).toBeLessThan(0)
   })
})

describe('grow splat: place', () => {
   it('fits the scale on the overlap and keeps only the gaussians in the hole, in world axes', () => {
      // the world: a wall at 4 m covering only the left half of a view turned 20° left
      const world = wall(4, -3, -0.3)
      const pose = { R: turn(20), C: [0, 0, 0] as [number, number, number] }
      const view = render(world, CAM, pose)
      // the lifted view: the whole wall, in the turned camera's axes, at half the world's scale
      const inWorld = wall(4, -3, 3)
      const toCam = [pose.R[0], pose.R[3], pose.R[6], pose.R[1], pose.R[4], pose.R[7], pose.R[2], pose.R[5], pose.R[8]] as const
      const lifted: Splat = { n: inWorld.n, data: new Float32Array(inWorld.data), camera: CAM }
      for (let g = 0; g < lifted.n; g++) {
         const b = g * STRIDE
         const p = [inWorld.data[b]!, inWorld.data[b + 1]!, inWorld.data[b + 2]!]
         for (let k = 0; k < 3; k++) lifted.data[b + k] = 0.5 * (toCam[k * 3]! * p[0]! + toCam[k * 3 + 1]! * p[1]! + toCam[k * 3 + 2]! * p[2]!)
         for (let k = 0; k < 3; k++) lifted.data[b + 7 + k] = inWorld.data[b + 7 + k]! + Math.log(0.5)
      }
      const placed = place({ lifted, world: view, cam: CAM, pose, keepBelow: 0.6 })
      expect(placed.fit.scale).toBeGreaterThan(1.9)
      expect(placed.fit.scale).toBeLessThan(2.1)
      expect(placed.kept.n).toBeGreaterThan(0)
      expect(placed.kept.n).toBeLessThan(lifted.n)
      // every kept gaussian is back on the world's wall plane, right of what the world had
      for (let g = 0; g < placed.kept.n; g++) {
         const b = g * STRIDE
         expect(placed.kept.data[b + 2]!).toBeGreaterThan(3.8)
         expect(placed.kept.data[b + 2]!).toBeLessThan(4.2)
         expect(placed.kept.data[b]!).toBeGreaterThan(-0.6)
      }
   })

   it('trims the gaussians that fall outside the picture', () => {
      const s = wall(2, -3, 3)
      const t = trimToFrame(s, CAM)
      expect(t.n).toBeGreaterThan(0)
      expect(t.n).toBeLessThan(s.n)
      for (let g = 0; g < t.n; g++) expect(Math.abs((CAM.f * t.data[g * STRIDE]!) / 2)).toBeLessThanOrEqual(CAM.cx)
   })

   it('refuses a lifted splat made for another camera', () => {
      const s = wall(2, -1, 1)
      const view = render(s, CAM, { R: IDENTITY, C: [0, 0, 0] })
      expect(() => place({ lifted: { ...s, camera: { ...CAM, f: 80 } }, world: view, cam: CAM, pose: { R: IDENTITY, C: [0, 0, 0] }, keepBelow: 0.6 })).toThrow(/made for f=80/)
   })
})
