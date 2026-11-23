// the palette measure and match of examples/rvion/flythroughPalette.ts: Lab conversions against known
// values, a frame's drift from itself is zero, and the match moves a frame onto the picture's palette
import { describe, expect, it } from 'bun:test'
import { driftOf, labToRgb, matchFrame, paletteOf, rgbToLab, smoothPalettes } from 'examples/rvion/flythroughPalette.ts'

/** a small frame of noise around one colour */
const frame = (rgb: [number, number, number], spread: number, seed = 1): Uint8Array => {
   let s = seed
   const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2 * spread
   const out = new Uint8Array(64 * 48 * 3)
   for (let i = 0; i < out.length; i += 3) for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(rgb[c]! + rnd())))
   return out
}

describe('Lab', () => {
   it('matches known sRGB values (D65)', () => {
      const white = rgbToLab(255, 255, 255)
      expect(white[0]).toBeCloseTo(100, 2)
      expect(Math.abs(white[1]) + Math.abs(white[2])).toBeLessThan(0.01)
      const red = rgbToLab(255, 0, 0)
      expect(red[0]).toBeCloseTo(53.24, 1)
      expect(red[1]).toBeCloseTo(80.09, 1)
      expect(red[2]).toBeCloseTo(67.2, 1)
   })

   it('goes back to the same bytes', () => {
      const colours: [number, number, number][] = [[12, 34, 56], [200, 180, 90], [3, 3, 3], [255, 0, 128]]
      for (const c of colours) expect(labToRgb(...rgbToLab(...c))).toEqual(c)
   })
})

describe('drift', () => {
   it('is zero against itself', () => {
      const p = paletteOf(frame([60, 64, 75], 20))
      const d = driftOf(p, p)
      expect(d.dE).toBe(0)
      expect(d.contrast).toBe(1)
      expect(d.saturation).toBe(1)
      expect(d.hue).toBeLessThan(1e-6)
   })

   it('sees a brighter, greener frame as brighter and greener', () => {
      const picture = paletteOf(frame([60, 64, 75], 20))
      const d = driftOf(paletteOf(frame([80, 100, 78], 20)), picture)
      expect(d.dL).toBeGreaterThan(5)
      expect(d.da).toBeLessThan(-5)
      expect(d.hue).toBeGreaterThan(0.3)
   })
})

describe('matchFrame', () => {
   it('moves a drifted frame onto the picture palette', () => {
      const picture = paletteOf(frame([60, 64, 75], 20, 3))
      const drifted = frame([90, 110, 80], 35, 4)
      const matched = paletteOf(matchFrame(drifted, paletteOf(drifted), picture, 1))
      const d = driftOf(matched, picture)
      expect(d.dE).toBeLessThan(1)
      expect(Math.abs(d.contrast - 1)).toBeLessThan(0.05)
   })

   it('at strength 0 leaves the frame as it was (up to the Lab round trip)', () => {
      const f = frame([90, 110, 80], 35, 4)
      const out = matchFrame(f, paletteOf(f), paletteOf(frame([10, 10, 10], 2)), 0)
      let worst = 0
      for (let i = 0; i < f.length; i++) worst = Math.max(worst, Math.abs(out[i]! - f[i]!))
      expect(worst).toBeLessThanOrEqual(1)
   })

   it('smoothing keeps a steady series steady', () => {
      const p = paletteOf(frame([60, 64, 75], 20))
      const smooth = smoothPalettes([p, p, p, p], 2)
      expect(smooth[2]!.mean[0]).toBeCloseTo(p.mean[0], 9)
   })
})
