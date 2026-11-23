// how far a fly-through drifts from its picture's palette, and the pull back. Each frame is measured
// in CIE Lab against the picture cover-cropped to the frame: the mean colour (ΔE between the means,
// the lightness and the green-red and blue-yellow axes alone), the spread of the lightness (contrast),
// the mean chroma (saturation) and a chroma weighted hue histogram (Hellinger distance, 0 = the same
// hues). The match moves each frame's Lab mean and spread to the picture's, with stats smoothed over
// time so the pull never flickers.
//
// run:  bun examples/rvion/flythroughPalette.ts measure <picture> <out.png> <label>=<video> …
//       bun examples/rvion/flythroughPalette.ts match <picture> <in.mp4> <out.mp4> [strength]
import { $ } from 'bun'
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'

/** sRGB 0..255 to linear, once per byte */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
   const c = i / 255
   return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
const D65 = [0.95047, 1, 1.08883] as const
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116)
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))
const toByte = (c: number) => {
   const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
   return Math.max(0, Math.min(255, Math.round(s * 255)))
}

/** one sRGB pixel to Lab (D65) */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
   const R = LINEAR[r]!
   const G = LINEAR[g]!
   const B = LINEAR[b]!
   const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / D65[0])
   const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B)
   const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / D65[2])
   return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** one Lab colour back to sRGB bytes */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
   const fy = (L + 16) / 116
   const X = D65[0] * fInv(fy + a / 500)
   const Y = fInv(fy)
   const Z = D65[2] * fInv(fy - b / 200)
   return [
      toByte(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z),
      toByte(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z),
      toByte(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z),
   ]
}

const HUE_BINS = 24
/** the chroma below which a pixel counts as grey */
const GREY = 1.5

/** a frame's palette: Lab mean and spread per channel, mean chroma, the chroma weighted hue histogram */
export type Palette = { mean: [number, number, number]; spread: [number, number, number]; chroma: number; hues: Float64Array }

export function paletteOf(rgb: Uint8Array): Palette {
   const n = rgb.length / 3
   const sum = [0, 0, 0]
   const sq = [0, 0, 0]
   let chroma = 0
   const hues = new Float64Array(HUE_BINS)
   for (let i = 0; i < n; i++) {
      const lab = rgbToLab(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!)
      for (let c = 0; c < 3; c++) {
         const x = lab[c]!
         sum[c]! += x
         sq[c]! += x * x
      }
      const C = Math.hypot(lab[1], lab[2])
      chroma += C
      // a near grey pixel's hue is noise (compression, the VAE): only the chroma past that counts,
      // shared between the two nearest bins so a hue on a bin's edge does not flip the distance
      const w = Math.max(0, C - GREY)
      if (w === 0) continue
      const h = ((Math.atan2(lab[2], lab[1]) + Math.PI) / (2 * Math.PI)) * HUE_BINS - 0.5
      const lo = Math.floor(h)
      const t = h - lo
      hues[(lo + HUE_BINS) % HUE_BINS]! += w * (1 - t)
      hues[(lo + 1) % HUE_BINS]! += w * t
   }
   // and smoothed once over the circle (1, 2, 1): a few degrees of turn is a small distance
   const soft = hues.map((x, k) => x * 2 + hues[(k + HUE_BINS - 1) % HUE_BINS]! + hues[(k + 1) % HUE_BINS]!)
   const total = soft.reduce((a, b) => a + b, 0) || 1
   for (let k = 0; k < HUE_BINS; k++) hues[k] = soft[k]! / total
   const mean = sum.map((s) => s / n) as [number, number, number]
   const spread = sq.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c]! ** 2))) as [number, number, number]
   return { mean, spread, chroma: chroma / n, hues }
}

/** a frame's drift from the picture, each in its own unit */
export type Drift = {
   /** ΔE (CIE76) between the two mean colours */
   dE: number
   /** lightness of the mean, frame minus picture (positive: brighter) */
   dL: number
   /** the green (−) to red (+) axis of the mean */
   da: number
   /** the blue (−) to yellow (+) axis of the mean */
   db: number
   /** the frame's lightness spread over the picture's (above 1: more contrast) */
   contrast: number
   /** the frame's mean chroma over the picture's (above 1: more saturated) */
   saturation: number
   /** Hellinger distance of the hue histograms, 0 = the same hues, 1 = none shared */
   hue: number
}

export function driftOf(frame: Palette, picture: Palette): Drift {
   let bc = 0
   for (let k = 0; k < HUE_BINS; k++) bc += Math.sqrt(frame.hues[k]! * picture.hues[k]!)
   const d = frame.mean.map((m, c) => m - picture.mean[c]!) as [number, number, number]
   return {
      dE: Math.hypot(...d),
      dL: d[0],
      da: d[1],
      db: d[2],
      contrast: frame.spread[0] / Math.max(picture.spread[0], 1e-6),
      saturation: frame.chroma / Math.max(picture.chroma, 1e-6),
      hue: Math.sqrt(Math.max(0, 1 - bc)),
   }
}

/** palettes smoothed over time: a gaussian of `sigma` frames over each mean and spread */
export function smoothPalettes(list: Palette[], sigma: number): Palette[] {
   const r = Math.ceil(sigma * 3)
   return list.map((_, i) => {
      const mean = [0, 0, 0]
      const spread = [0, 0, 0]
      let w = 0
      for (let j = Math.max(0, i - r); j <= Math.min(list.length - 1, i + r); j++) {
         const k = Math.exp(-((j - i) ** 2) / (2 * sigma * sigma))
         for (let c = 0; c < 3; c++) {
            mean[c]! += k * list[j]!.mean[c]!
            spread[c]! += k * list[j]!.spread[c]!
         }
         w += k
      }
      const own = list[i]!
      return { ...own, mean: mean.map((x) => x / w) as Palette['mean'], spread: spread.map((x) => x / w) as Palette['spread'] }
   })
}

/** the frame moved toward the picture's Lab mean and spread, per channel, `strength` of the way
 * (1 = all of it); the spread gain stays within 0.5 to 2, so a frame of one material is not blown up */
export function matchFrame(rgb: Uint8Array, from: Palette, to: Palette, strength: number): Uint8Array {
   const gain = [0, 1, 2].map((c) => Math.min(2, Math.max(0.5, to.spread[c]! / Math.max(from.spread[c]!, 1e-6))))
   const out = new Uint8Array(rgb.length)
   for (let i = 0; i < rgb.length; i += 3) {
      const lab = rgbToLab(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!)
      const moved = lab.map((x, c) => {
         const matched = (x - from.mean[c]!) * gain[c]! + to.mean[c]!
         return x + (matched - x) * strength
      }) as [number, number, number]
      const back = labToRgb(moved[0], moved[1], moved[2])
      out[i] = back[0]
      out[i + 1] = back[1]
      out[i + 2] = back[2]
   }
   return out
}

/** a picture cover-cropped to `width` × `height`, as raw rgb */
export async function pictureAt(picture: string, width: number, height: number): Promise<Uint8Array> {
   return new Uint8Array(await sharp(picture).removeAlpha().resize(width, height, { fit: 'cover' }).raw().toBuffer())
}

/** a video's width and height */
export async function videoSize(file: string): Promise<{ width: number; height: number }> {
   const out = await $`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 ${file}`.text()
   const [width, height] = out.trim().split(',').map(Number) as [number, number]
   return { width, height }
}

/** every frame of a video, `width` × `height` rgb, streamed to `each` */
export async function eachFrame(file: string, width: number, height: number, each: (rgb: Uint8Array, i: number) => void | Promise<void>): Promise<number> {
   const proc = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', file, '-vf', `scale=${width}:${height}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { stdout: 'pipe' })
   const size = width * height * 3
   let buf = new Uint8Array(size)
   let fill = 0
   let i = 0
   for await (const chunk of proc.stdout) {
      let off = 0
      while (off < chunk.length) {
         const take = Math.min(size - fill, chunk.length - off)
         buf.set(chunk.subarray(off, off + take), fill)
         fill += take
         off += take
         if (fill === size) {
            await each(buf, i++)
            buf = new Uint8Array(size)
            fill = 0
         }
      }
   }
   if ((await proc.exited) !== 0) throw new Error(`eachFrame: ffmpeg failed on ${file}`)
   return i
}

/** the drift of every frame of a video from the picture, measured at a small size */
export async function measureVideo(picture: string, file: string): Promise<Drift[]> {
   const size = await videoSize(file)
   const width = 192
   const height = Math.round((size.height / size.width) * width / 2) * 2
   const ref = paletteOf(await pictureAt(picture, width, height))
   const out: Drift[] = []
   await eachFrame(file, width, height, (rgb) => void out.push(driftOf(paletteOf(rgb), ref)))
   return out
}

/** every frame of a video matched to the picture (its stats smoothed over a sixth of a second: wider, a drifting start pulls frame 0 off the picture), into an mp4 at its fps */
export async function matchVideo(p: { picture: string; input: string; output: string; strength: number }): Promise<void> {
   const size = await videoSize(p.input)
   const fps = (await $`ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 ${p.input}`.text()).trim()
   const small = { width: 192, height: Math.round((size.height / size.width) * 96) * 2 }
   const ref = paletteOf(await pictureAt(p.picture, small.width, small.height))
   const own: Palette[] = []
   await eachFrame(p.input, small.width, small.height, (rgb) => void own.push(paletteOf(rgb)))
   const fpsValue = fps.split('/').map(Number).reduce((a, b) => a / b)
   const smooth = smoothPalettes(own, fpsValue / 6)
   const enc = Bun.spawn(
      ['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${size.width}x${size.height}`, '-r', fps, '-i', '-', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', p.output],
      { stdin: 'pipe' },
   )
   await eachFrame(p.input, size.width, size.height, (rgb, i) => {
      const from = smooth[i]
      if (from == null) throw new Error(`matchVideo: frame ${i} was not measured`)
      enc.stdin.write(matchFrame(rgb, from, ref, p.strength))
   })
   await enc.stdin.end()
   if ((await enc.exited) !== 0) throw new Error(`matchVideo: the encoder failed on ${p.output}`)
}

/** the drift curves of several videos as one picture: a panel per measure, a line per video */
export async function driftChart(series: { label: string; drift: Drift[] }[], out: string): Promise<void> {
   const panels: { key: keyof Drift; title: string; lo: number; hi: number; mark?: number }[] = [
      { key: 'dE', title: 'ΔE of the mean colour (0 = the picture)', lo: 0, hi: 20 },
      { key: 'dL', title: 'lightness of the mean, against the picture', lo: -25, hi: 25, mark: 0 },
      { key: 'saturation', title: 'saturation, against the picture (1 = the same)', lo: 0, hi: 3, mark: 1 },
      { key: 'contrast', title: 'contrast, against the picture (1 = the same)', lo: 0, hi: 3, mark: 1 },
      { key: 'hue', title: 'hue histogram distance (0 = the same hues)', lo: 0, hi: 0.6 },
      { key: 'da', title: 'green (−) to red (+), against the picture', lo: -8, hi: 8, mark: 0 },
      { key: 'db', title: 'blue (−) to yellow (+), against the picture', lo: -8, hi: 8, mark: 0 },
   ]
   const colours = ['#e6550d', '#3182bd', '#31a354', '#756bb1', '#d6616b', '#8c6d31', '#17becf']
   const W = 520
   const H = 190
   const pad = { l: 44, r: 12, t: 26, b: 20 }
   const cols = 2
   const legend = 28
   const width = W * cols
   const height = legend + H * Math.ceil(panels.length / cols)
   const frames = Math.max(...series.map((s) => s.drift.length), 2)
   const parts: string[] = [`<rect width="${width}" height="${height}" fill="#ffffff"/>`]
   series.forEach((s, i) => {
      const x = 12 + i * 170
      parts.push(`<rect x="${x}" y="9" width="14" height="4" fill="${colours[i % colours.length]}"/><text x="${x + 20}" y="16" font-size="13" font-family="Helvetica" fill="#222">${s.label}</text>`)
   })
   panels.forEach((panel, k) => {
      const ox = (k % cols) * W
      const oy = legend + Math.floor(k / cols) * H
      const pw = W - pad.l - pad.r
      const ph = H - pad.t - pad.b
      const X = (i: number) => ox + pad.l + (i / (frames - 1)) * pw
      const Y = (v: number) => oy + pad.t + (1 - (Math.max(panel.lo, Math.min(panel.hi, v)) - panel.lo) / (panel.hi - panel.lo)) * ph
      parts.push(`<text x="${ox + pad.l}" y="${oy + 16}" font-size="13" font-family="Helvetica" fill="#222">${panel.title}</text>`)
      parts.push(`<rect x="${ox + pad.l}" y="${oy + pad.t}" width="${pw}" height="${ph}" fill="none" stroke="#ccc"/>`)
      for (const v of [panel.lo, panel.hi]) parts.push(`<text x="${ox + pad.l - 4}" y="${Y(v) + 4}" font-size="11" text-anchor="end" font-family="Helvetica" fill="#666">${v}</text>`)
      if (panel.mark != null) parts.push(`<line x1="${X(0)}" x2="${X(frames - 1)}" y1="${Y(panel.mark)}" y2="${Y(panel.mark)}" stroke="#999" stroke-dasharray="3 3"/>`)
      series.forEach((s, i) => {
         const d = s.drift.map((x, j) => `${j === 0 ? 'M' : 'L'}${X(j).toFixed(1)},${Y(x[panel.key]).toFixed(1)}`).join('')
         parts.push(`<path d="${d}" fill="none" stroke="${colours[i % colours.length]}" stroke-width="1.6"/>`)
      })
   })
   const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`
   await sharp(Buffer.from(svg)).png().toFile(out)
}

/** one line per video: the mean of each measure over its frames, and its worst ΔE */
export function driftSummary(label: string, drift: Drift[]): string {
   const avg = (k: keyof Drift) => drift.reduce((a, d) => a + d[k], 0) / Math.max(drift.length, 1)
   const worst = Math.max(...drift.map((d) => d.dE))
   return `${label}: ΔE ${avg('dE').toFixed(1)} (worst ${worst.toFixed(1)}), L ${avg('dL').toFixed(1)}, a ${avg('da').toFixed(1)}, b ${avg('db').toFixed(1)}, contrast ${avg('contrast').toFixed(2)}, saturation ${avg('saturation').toFixed(2)}, hue ${avg('hue').toFixed(3)}`
}

if (import.meta.main) {
   const [mode, picture, ...rest] = process.argv.slice(2)
   if (mode === 'measure' && picture != null && rest.length >= 2) {
      const [out, ...pairs] = rest
      const series: { label: string; drift: Drift[] }[] = []
      for (const pair of pairs) {
         const at = pair.indexOf('=')
         const label = at < 0 ? pair : pair.slice(0, at)
         const drift = await measureVideo(picture, at < 0 ? pair : pair.slice(at + 1))
         series.push({ label, drift })
         console.log(driftSummary(label, drift))
      }
      await driftChart(series, out!)
      writeFileSync(`${out}.json`, JSON.stringify(series.map((s) => ({ label: s.label, summary: driftSummary(s.label, s.drift), drift: s.drift }))))
      console.log(`🟢 ${out}`)
   } else if (mode === 'match' && picture != null && rest.length >= 2) {
      const [input, output, strength] = rest
      await matchVideo({ picture, input: input!, output: output!, strength: Number(strength ?? 1) })
      console.log(`🟢 ${output}`)
   } else
      throw new Error(
         'usage: bun examples/rvion/flythroughPalette.ts measure <picture> <out.png> <label>=<video> … | match <picture> <in.mp4> <out.mp4> [strength]',
      )
}
