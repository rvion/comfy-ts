// the camera paths of examples/rvion/19-flythrough: frame 0 is the picture's own camera, the speed
// stays steady where clips join, and the orbit keeps its centre in view at its radius
import { describe, expect, it } from 'bun:test'
import { colmapPose } from 'examples/rvion/flythroughColmap.ts'
import { readSplatPly, toViewerAxes } from 'examples/rvion/flythroughSplat.ts'
import { orbitPath, pathCameras, walkPath } from 'examples/rvion/flythroughPath.ts'

const step = (a: { position: number[] }, b: { position: number[] }) =>
   Math.hypot(b.position[0]! - a.position[0]!, b.position[1]! - a.position[1]!, b.position[2]! - a.position[2]!)

describe('walkPath', () => {
   it('starts at the picture, looks ahead, ends `distance` away', () => {
      const path = walkPath({ frames: 81, distance: 2.5, turn: 0, rise: 0 })
      expect(path[0]).toEqual({ position: [0, 0, 0], target: [0, 0, -1] })
      expect(path.at(-1)?.position[2]).toBeCloseTo(-2.5, 6)
   })
})

describe('orbitPath', () => {
   const center: [number, number] = [0, -15]
   const path = orbitPath({ frames: 561, center, radius: 6, sweep: 180 })

   it('starts at the picture looking straight ahead', () => {
      const first = path[0]
      expect(first?.position).toEqual([0, 0, 0])
      expect(first?.target[0]).toBeCloseTo(0, 6)
      expect(first?.target[2]).toBeLessThan(-1)
   })

   it('ends half way round, on the circle behind the centre, looking at it', () => {
      const last = path.at(-1)
      expect(last?.position[0]).toBeCloseTo(0, 3)
      expect(last?.position[2]).toBeCloseTo(-21, 3)
      expect(last?.target).toEqual([0, 0, -15])
   })

   it('goes round by the right for a positive sweep', () => {
      const quarter = path.find((c) => c.position[2] < -15)
      expect(quarter?.position[0]).toBeGreaterThan(5)
   })

   it('moves at one speed in the middle of the path, so clips join without a jump', () => {
      const steps = path.slice(100, 460).map((c, i) => step(path[99 + i]!, c))
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length
      for (const s of steps) expect(Math.abs(s - mean) / mean).toBeLessThan(0.02)
   })

   it('refuses a camera that starts inside the circle', () => {
      expect(() => orbitPath({ frames: 10, center: [0, -3], radius: 6, sweep: 90 })).toThrow('inside the circle')
   })
})

describe('pathCameras', () => {
   it('clips share their joining frame: clips × (length - 1) + 1 cameras', () => {
      const all = pathCameras({ path: 'walk', length: 81, clips: 3, fovX: 60, distance: 6, turn: 0, rise: 0, aim: 0.5, aimDistance: 10, radius: 3, sweep: 90 })
      expect(all.length).toBe(241)
   })

   it('aims the orbit at the picture column `aim`, `aimDistance` away', () => {
      const all = pathCameras({ path: 'orbit', length: 81, clips: 2, fovX: 90, distance: 0, turn: 0, rise: 0, aim: 1, aimDistance: 10, radius: 3, sweep: 90 })
      // aim 1 = the right edge: 45° right of straight ahead for a 90° picture
      const end = all.at(-1)
      expect(end?.target[0]).toBeCloseTo(10 * Math.SQRT1_2, 6)
      expect(end?.target[2]).toBeCloseTo(-10 * Math.SQRT1_2, 6)
   })
})

describe('colmapPose', () => {
   const project = (pose: ReturnType<typeof colmapPose>, p: [number, number, number]) => {
      const [w, x, y, z] = pose.q
      // rotate by the quaternion, then translate
      const R = [
         [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
         [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
         [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
      ]
      return R.map((row, i) => row[0]! * p[0] + row[1]! * p[1] + row[2]! * p[2] + pose.t[i]!)
   }

   it('a point ahead is in front (z > 0), right is +x, up is -y, as COLMAP wants', () => {
      const pose = colmapPose({ position: [0, 0, 0], target: [0, 0, -1] })
      const ahead = project(pose, [0, 0, -5])
      expect(ahead[2]).toBeCloseTo(5, 6)
      expect(project(pose, [1, 0, -5])[0]).toBeCloseTo(1, 6)
      expect(project(pose, [0, 1, -5])[1]).toBeCloseTo(-1, 6)
   })

   it('a moved, turned camera sees its own target straight ahead', () => {
      const cam = { position: [2, 1, -3] as [number, number, number], target: [5, 1, -7] as [number, number, number] }
      const seen = project(colmapPose(cam), cam.target)
      expect(seen[0]).toBeCloseTo(0, 6)
      expect(seen[1]).toBeCloseTo(0, 6)
      expect(seen[2]).toBeCloseTo(5, 6)
   })
})

describe('toViewerAxes', () => {
   it('turns a splat 180° about x: position (x, -y, -z), rotation (0, 1, 0, 0) ⊗ q', () => {
      const names = ['f_dc_0', 'f_dc_1', 'f_dc_2', 'x', 'y', 'z', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
      // identity rotation, then a quarter turn about y
      const s = Math.SQRT1_2
      const rows = [
         [0.1, 0.2, 0.3, 1, 2, -3, 0.5, -1, -2, -3, 1, 0, 0, 0],
         [0.1, 0.2, 0.3, 1, 2, -3, 0.5, -1, -2, -3, s, 0, s, 0],
      ]
      const out = toViewerAxes({ names, count: 2, data: Float32Array.from(rows.flat()) })
      const { names: outNames, data } = readSplatPly(out)
      const row = (i: number) => Object.fromEntries(outNames.map((n, k) => [n, data[i * outNames.length + k]!]))
      expect([row(0).x, row(0).y, row(0).z]).toEqual([1, -2, 3])
      expect([row(0).rot_0, row(0).rot_1, row(0).rot_2, row(0).rot_3]).toEqual([-0, 1, -0, 0])
      expect(row(0).f_dc_1).toBeCloseTo(0.2, 6)
      // (0,1,0,0) ⊗ (s,0,s,0) = (0, s, 0, s)
      expect(row(1).rot_0).toBeCloseTo(0, 6)
      expect(row(1).rot_1).toBeCloseTo(s, 6)
      expect(row(1).rot_2).toBeCloseTo(0, 6)
      expect(row(1).rot_3).toBeCloseTo(s, 6)
   })
})
