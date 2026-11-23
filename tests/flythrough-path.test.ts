// the camera paths of examples/rvion/19-flythrough: frame 0 is the picture's own camera, the speed
// stays steady where clips join, and the orbit keeps its centre in view at its radius
import { describe, expect, it } from 'bun:test'
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
