import { describe, expect, it } from 'bun:test'
import { colmapPose } from 'examples/rvion/flythroughColmap.ts'
import { splitFrames, type Frame } from 'examples/rvion/splatDataset.ts'
import { colmapToPose, prune, psnr, readTrained, seenBy, shColors, splatShape, ssim, writeTrained, type TrainedSplat } from 'examples/rvion/splatEval.ts'
import { STRIDE, type SplatCamera } from 'examples/rvion/grow-splat/ply.ts'

const CAM: SplatCamera = { f: 40, cx: 32, cy: 24, width: 64, height: 48 }

/** gaussians at the given centres, round (scale 0.1) unless scales are given, sh rest of degree 1 */
function splat(centres: [number, number, number][], scales?: [number, number, number][]): TrainedSplat {
   const data = new Float32Array(centres.length * STRIDE)
   centres.forEach((c, i) => {
      const s = scales?.[i] ?? [0.1, 0.1, 0.1]
      data.set([...c, 0.5, 0.5, 0.5, 2, Math.log(s[0]), Math.log(s[1]), Math.log(s[2]), 1, 0, 0, 0], i * STRIDE)
   })
   return { n: centres.length, data, camera: null, sh: new Float32Array(centres.length * 9).map((_, k) => k / 10), shCount: 3 }
}

describe('splat eval', () => {
   it('a COLMAP pose turns back into the camera it came from', () => {
      const cam = { position: [1, 2, 3] as [number, number, number], target: [4, 1, -2] as [number, number, number] }
      const pose = colmapToPose(colmapPose(cam))
      pose.C.forEach((v, i) => expect(v).toBeCloseTo(cam.position[i]!, 5))
      // the camera's z axis (third column) points at the target
      const f = cam.target.map((v, i) => v - cam.position[i]!)
      const l = Math.hypot(...f)
      expect(pose.R[2]).toBeCloseTo(f[0]! / l, 5)
      expect(pose.R[5]).toBeCloseTo(f[1]! / l, 5)
      expect(pose.R[8]).toBeCloseTo(f[2]! / l, 5)
   })

   it('a trained ply survives a write and a read, sh included', () => {
      const s = splat([[0, 0, 2], [1, 0, 3]])
      const back = readTrained(writeTrained(s))
      expect(back.n).toBe(2)
      expect(back.shCount).toBe(3)
      expect(Array.from(back.data)).toEqual(Array.from(s.data))
      expect(Array.from(back.sh)).toEqual(Array.from(s.sh))
   })

   it('the view dependent colour changes with the eye, the dc colour alone does not', () => {
      const s = splat([[0, 0, 2]])
      const a = shColors(s, [0, 0, 0])
      const b = shColors(s, [3, 0, 2])
      expect(Array.from(a)).not.toEqual(Array.from(b))
      const flat = { ...s, sh: new Float32Array(9) }
      expect(Array.from(shColors(flat, [0, 0, 0]))).toEqual(Array.from(shColors(flat, [3, 0, 2])))
   })

   it('psnr and ssim: a picture against itself is perfect, against noise much worse', () => {
      const W = 32
      const H = 24
      const a = new Float32Array(W * H * 3).map((_, i) => (i % 7) / 7)
      const b = a.map((v, i) => Math.min(1, Math.max(0, v + (((i * 7919) % 13) - 6) / 20)))
      expect(psnr(a, a)).toBe(99)
      expect(ssim(a, a, W, H)).toBeCloseTo(1, 5)
      expect(psnr(a, b)).toBeLessThan(20)
      expect(ssim(a, b, W, H)).toBeLessThan(0.9)
   })

   it('counts needles and unseen splats, and prunes them', () => {
      // one round splat in front of the camera, one needle in front, one behind the camera
      const s = splat([[0, 0, 2], [0.1, 0, 2], [0, 0, -2]], [[0.1, 0.1, 0.1], [3, 0.1, 0.1], [0.1, 0.1, 0.1]])
      const seen = seenBy(s, CAM, [{ q: [1, 0, 0, 0], t: [0, 0, 0] }])
      expect(Array.from(seen)).toEqual([1, 1, 0])
      const shape = splatShape(s, seen)
      expect(shape.needle20).toBe(1)
      expect(shape.seen0).toBe(1)
      const pruned = prune(s, seen, { minSeen: 1, maxNeedle: 5 })
      expect(pruned.n).toBe(2)
      expect(splatShape(pruned, seenBy(pruned, CAM, [{ q: [1, 0, 0, 0], t: [0, 0, 0] }])).needle20).toBe(0)
      expect(Math.exp(pruned.data[STRIDE + 7]!)).toBeCloseTo(0.5, 5)
   })

   it('the split holds out the same frames whatever trains, and trains on nothing near them', () => {
      const frames: Frame[] = []
      for (let clip = 0; clip < 2; clip++)
         for (let frame = 0; frame < 100; frame++) frames.push({ clip, frame, score: frame > 60 ? 0.2 : 0.9, name: `c${clip}-f${String(frame).padStart(3, '0')}.png` })
      const sparse = splitFrames(frames, { every: 4, gap: 3, minScore: 0 })
      const dense = splitFrames(frames, { every: 1, gap: 3, minScore: 0.5 })
      expect(dense.heldout).toEqual(sparse.heldout)
      expect(sparse.heldout[0]).toBe('c0-f016.png')
      expect(dense.train).not.toContain('c0-f013.png')
      expect(dense.train).toContain('c0-f012.png')
      expect(dense.train).not.toContain('c0-f070.png')
      expect(dense.train.length).toBeGreaterThan(sparse.train.length)
      for (const h of sparse.heldout) expect(sparse.train).not.toContain(h)
   })
})
