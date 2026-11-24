// how good a trained splat is, measured: each COLMAP camera rendered with the CPU rasterizer (view dependent
// colour included) and scored against its frame (PSNR, SSIM), plus the shape of the splats themselves: needles
// (one axis far longer than the others) and splats few training cameras ever see. Also the pruning those
// numbers call for. Works in the trainer's own world (the COLMAP export's), before any turn to viewer axes.
//
// run:  bun examples/rvion/splatEval.ts <trained.ply> <colmap dir> <split.json> [--out <dir>] [--shots name,name]
//       split.json: { heldout: string[], train: string[] } (image names), as splatDataset.ts writes it
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import sharp from 'sharp'
import { readSplatPly } from './flythroughSplat.ts'
import { F, STRIDE, type Splat, type SplatCamera } from './grow-splat/ply.ts'
import { quatToMat, render, transpose3, type Pose } from './grow-splat/raster.ts'

export type ColmapImage = { id: number; name: string; q: [number, number, number, number]; t: [number, number, number] }
export type Colmap = { camera: SplatCamera; images: ColmapImage[] }

/** a COLMAP text model with one PINHOLE camera (what flythroughColmap.ts writes) */
export function readColmap(sparse: string): Colmap {
   const camLine = readFileSync(join(sparse, 'cameras.txt'), 'utf8').split('\n').find((l) => l.trim() !== '' && !l.startsWith('#'))
   const w = camLine?.trim().split(/\s+/) ?? []
   if (w[1] !== 'PINHOLE') throw new Error(`readColmap: one PINHOLE camera expected, got ${camLine}`)
   const camera = { width: Number(w[2]), height: Number(w[3]), f: Number(w[4]), cx: Number(w[6]), cy: Number(w[7]) }
   const images: ColmapImage[] = []
   for (const line of readFileSync(join(sparse, 'images.txt'), 'utf8').split('\n')) {
      const p = line.trim().split(/\s+/)
      if (line.startsWith('#') || p.length < 10) continue
      const n = p.slice(0, 8).map(Number)
      images.push({ id: n[0]!, q: [n[1]!, n[2]!, n[3]!, n[4]!], t: [n[5]!, n[6]!, n[7]!], name: p[9]! })
   }
   return { camera, images }
}

/** the rasterizer's pose (camera axes as columns, its centre) from a COLMAP world to camera pose */
export function colmapToPose(img: Pick<ColmapImage, 'q' | 't'>): Pose {
   const toCam = quatToMat(...img.q)
   const R = transpose3(toCam)
   const t = img.t
   return { R, C: [-(R[0] * t[0] + R[1] * t[1] + R[2] * t[2]), -(R[3] * t[0] + R[4] * t[1] + R[5] * t[2]), -(R[6] * t[0] + R[7] * t[1] + R[8] * t[2])] }
}

/** a trained 3DGS ply (Brush, INRIA layout): the gaussians and their sh rest coefficients (channel major, 15 a channel at degree 3) */
export type TrainedSplat = Splat & { sh: Float32Array; shCount: number }

export function readTrained(bytes: Uint8Array): TrainedSplat {
   const ply = readSplatPly(bytes)
   const P = ply.names.length
   const at = (name: string) => {
      const i = ply.names.indexOf(name)
      if (i < 0) throw new Error(`readTrained: no property ${name}`)
      return i
   }
   const src = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].map(at)
   const rest = ply.names.filter((n) => n.startsWith('f_rest_')).length
   const restAt = Array.from({ length: rest }, (_, k) => at(`f_rest_${k}`))
   const shCount = rest / 3
   const data = new Float32Array(ply.count * STRIDE)
   const sh = new Float32Array(ply.count * rest)
   for (let i = 0; i < ply.count; i++) {
      for (let k = 0; k < STRIDE; k++) data[i * STRIDE + k] = ply.data[i * P + src[k]!]!
      for (let k = 0; k < rest; k++) sh[i * rest + k] = ply.data[i * P + restAt[k]!]!
   }
   return { n: ply.count, data, camera: null, sh, shCount }
}

/** the trained ply again, with only the kept gaussians (and every property, sh included) */
export function writeTrained(s: TrainedSplat): Uint8Array {
   const rest = s.shCount * 3
   const names = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: rest }, (_, k) => `f_rest_${k}`), 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
   const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${s.n}\n${names.map((p) => `property float ${p}`).join('\n')}\nend_header\n`)
   const row = names.length
   const out = new Float32Array(s.n * row)
   for (let i = 0; i < s.n; i++) {
      const b = i * STRIDE
      const o = i * row
      out.set(s.data.subarray(b, b + 6), o)
      out.set(s.sh.subarray(i * rest, (i + 1) * rest), o + 6)
      out.set(s.data.subarray(b + 6, b + STRIDE), o + 6 + rest)
   }
   const bytes = new Uint8Array(header.length + out.byteLength)
   bytes.set(header)
   bytes.set(new Uint8Array(out.buffer), header.length)
   return bytes
}

const C0 = 0.28209479177387814
const C1 = 0.4886025119029199
const C2 = [1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396]
const C3 = [-0.5900435899266435, 2.890611442640554, -0.4570457994644658, 0.3731763325901154, -0.4570457994644658, 1.445305721320277, -0.5900435899266435]

/** each gaussian's colour seen from `eye` (sh up to degree 3), 0..1 */
export function shColors(s: TrainedSplat, eye: [number, number, number]): Float32Array {
   const out = new Float32Array(s.n * 3)
   const K = s.shCount
   const basis = new Float32Array(15)
   for (let i = 0; i < s.n; i++) {
      const b = i * STRIDE
      let x = s.data[b]! - eye[0]
      let y = s.data[b + 1]! - eye[1]
      let z = s.data[b + 2]! - eye[2]
      const l = Math.hypot(x, y, z) || 1
      x /= l
      y /= l
      z /= l
      if (K >= 3) {
         basis[0] = -C1 * y
         basis[1] = C1 * z
         basis[2] = -C1 * x
      }
      if (K >= 8) {
         const xx = x * x
         const yy = y * y
         const zz = z * z
         basis[3] = C2[0]! * x * y
         basis[4] = C2[1]! * y * z
         basis[5] = C2[2]! * (2 * zz - xx - yy)
         basis[6] = C2[3]! * x * z
         basis[7] = C2[4]! * (xx - yy)
         if (K >= 15) {
            basis[8] = C3[0]! * y * (3 * xx - yy)
            basis[9] = C3[1]! * x * y * z
            basis[10] = C3[2]! * y * (4 * zz - xx - yy)
            basis[11] = C3[3]! * z * (2 * zz - 3 * xx - 3 * yy)
            basis[12] = C3[4]! * x * (4 * zz - xx - yy)
            basis[13] = C3[5]! * z * (xx - yy)
            basis[14] = C3[6]! * x * (xx - 3 * yy)
         }
      }
      for (let c = 0; c < 3; c++) {
         let v = 0.5 + C0 * s.data[b + F.dc + c]!
         const o = (i * 3 + c) * K
         for (let k = 0; k < K; k++) v += basis[k]! * s.sh[o + k]!
         out[i * 3 + c] = Math.min(1, Math.max(0, v))
      }
   }
   return out
}

/** the splat seen from one COLMAP camera, rgb 0..1 */
export function renderView(s: TrainedSplat, cam: SplatCamera, img: Pick<ColmapImage, 'q' | 't'>): Float32Array {
   const pose = colmapToPose(img)
   return render(s, cam, pose, { colors: shColors(s, pose.C) }).color
}

/** rgb 0..1 of a picture file */
export async function readRgb(file: string): Promise<{ rgb: Float32Array; width: number; height: number }> {
   const r = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
   const rgb = new Float32Array(r.data.length)
   for (let i = 0; i < r.data.length; i++) rgb[i] = r.data[i]! / 255
   return { rgb, width: r.info.width, height: r.info.height }
}

export async function writeRgb(file: string, rgb: Float32Array, width: number, height: number): Promise<void> {
   const px = new Uint8Array(rgb.length)
   for (let i = 0; i < rgb.length; i++) px[i] = Math.round(Math.min(1, Math.max(0, rgb[i]!)) * 255)
   await sharp(px, { raw: { width, height, channels: 3 } }).png().toFile(file)
}

/** peak signal to noise, dB, of two rgb 0..1 pictures; both quantised to 8 bits first, as a saved frame is */
export function psnr(a: Float32Array, b: Float32Array): number {
   let se = 0
   for (let i = 0; i < a.length; i++) {
      const d = Math.round(a[i]! * 255) / 255 - Math.round(b[i]! * 255) / 255
      se += d * d
   }
   const mse = se / a.length
   return mse === 0 ? 99 : -10 * Math.log10(mse)
}

/** separable gaussian blur (11 taps, sigma 1.5) of one channel, the window of the SSIM paper; borders clamped */
function blur(src: Float32Array, W: number, H: number): Float32Array {
   const k: number[] = []
   for (let i = -5; i <= 5; i++) k.push(Math.exp(-(i * i) / (2 * 1.5 * 1.5)))
   const sum = k.reduce((a, b) => a + b, 0)
   const kn = k.map((x) => x / sum)
   const tmp = new Float32Array(W * H)
   const out = new Float32Array(W * H)
   for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
         let v = 0
         for (let i = -5; i <= 5; i++) v += kn[i + 5]! * src[y * W + Math.min(W - 1, Math.max(0, x + i))]!
         tmp[y * W + x] = v
      }
   for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
         let v = 0
         for (let i = -5; i <= 5; i++) v += kn[i + 5]! * tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x]!
         out[y * W + x] = v
      }
   return out
}

/** structural similarity of two rgb 0..1 pictures, the mean over the channels (gaussian window, as Brush and gsplat compute it) */
export function ssim(a: Float32Array, b: Float32Array, W: number, H: number): number {
   const c1 = 0.01 ** 2
   const c2 = 0.03 ** 2
   let total = 0
   for (let c = 0; c < 3; c++) {
      const x = new Float32Array(W * H)
      const y = new Float32Array(W * H)
      for (let i = 0; i < W * H; i++) {
         x[i] = a[i * 3 + c]!
         y[i] = b[i * 3 + c]!
      }
      const mx = blur(x, W, H)
      const my = blur(y, W, H)
      const xx = blur(x.map((v) => v * v), W, H)
      const yy = blur(y.map((v) => v * v), W, H)
      const xy = blur(x.map((v, i) => v * y[i]!), W, H)
      let s = 0
      for (let i = 0; i < W * H; i++) {
         const vx = xx[i]! - mx[i]! ** 2
         const vy = yy[i]! - my[i]! ** 2
         const cxy = xy[i]! - mx[i]! * my[i]!
         s += ((2 * mx[i]! * my[i]! + c1) * (2 * cxy + c2)) / ((mx[i]! ** 2 + my[i]! ** 2 + c1) * (vx + vy + c2))
      }
      total += s / (W * H)
   }
   return total / 3
}

/** how many cameras have each gaussian's centre in their picture, in front of them (occlusion not counted) */
export function seenBy(s: Splat, cam: SplatCamera, images: Pick<ColmapImage, 'q' | 't'>[]): Uint16Array {
   const count = new Uint16Array(s.n)
   for (const img of images) {
      const R = quatToMat(...img.q)
      const t = img.t
      for (let g = 0; g < s.n; g++) {
         const b = g * STRIDE
         const x = s.data[b]!
         const y = s.data[b + 1]!
         const z = s.data[b + 2]!
         const cz = R[6] * x + R[7] * y + R[8] * z + t[2]
         if (cz < 0.05) continue
         const u = (cam.f * (R[0] * x + R[1] * y + R[2] * z + t[0])) / cz + cam.cx
         const v = (cam.f * (R[3] * x + R[4] * y + R[5] * z + t[1])) / cz + cam.cy
         if (u >= 0 && u < cam.width && v >= 0 && v < cam.height) count[g] = count[g]! + 1
      }
   }
   return count
}

/** each gaussian's axes, longest first, as sizes (not logs) */
export function axes(s: Splat, g: number): [number, number, number] {
   const b = g * STRIDE + F.scale
   return [Math.exp(s.data[b]!), Math.exp(s.data[b + 1]!), Math.exp(s.data[b + 2]!)].sort((p, q) => q - p) as [number, number, number]
}

export const opacityOf = (s: Splat, g: number): number => 1 / (1 + Math.exp(-s.data[g * STRIDE + F.opacity]!))

export type SplatShape = {
   count: number
   /** long axis over the short one above 20 (a needle or a flat disc) */
   ratio20: number
   /** long axis over the middle one above 20: a true needle, long in one direction only */
   needle20: number
   /** the needles among the gaussians that show (opacity over 0.1) */
   needle20Visible: number
   /** seen by no training camera, and by fewer than 3 */
   seen0: number
   seenUnder3: number
   seenUnder3Visible: number
}

export function splatShape(s: Splat, seen: Uint16Array): SplatShape {
   const r: SplatShape = { count: s.n, ratio20: 0, needle20: 0, needle20Visible: 0, seen0: 0, seenUnder3: 0, seenUnder3Visible: 0 }
   for (let g = 0; g < s.n; g++) {
      const [a, b, c] = axes(s, g)
      const visible = opacityOf(s, g) > 0.1
      if (a > 20 * c) r.ratio20++
      if (a > 20 * b) {
         r.needle20++
         if (visible) r.needle20Visible++
      }
      if (seen[g] === 0) r.seen0++
      if (seen[g]! < 3) {
         r.seenUnder3++
         if (visible) r.seenUnder3Visible++
      }
   }
   return r
}

export type PruneRule = {
   /** drop a gaussian seen by fewer training cameras than this */
   minSeen?: number
   /** a needle's long axis cut to this many times its middle one */
   maxNeedle?: number
}

/** the splat with the rule applied: unseen gaussians dropped, needles shortened (their volume shrinks with them) */
export function prune(s: TrainedSplat, seen: Uint16Array, rule: PruneRule): TrainedSplat {
   const keep: number[] = []
   for (let g = 0; g < s.n; g++) if (rule.minSeen == null || seen[g]! >= rule.minSeen) keep.push(g)
   const rest = s.shCount * 3
   const data = new Float32Array(keep.length * STRIDE)
   const sh = new Float32Array(keep.length * rest)
   keep.forEach((g, i) => {
      data.set(s.data.subarray(g * STRIDE, (g + 1) * STRIDE), i * STRIDE)
      sh.set(s.sh.subarray(g * rest, (g + 1) * rest), i * rest)
      if (rule.maxNeedle != null) {
         const b = i * STRIDE + F.scale
         const logs = [data[b]!, data[b + 1]!, data[b + 2]!]
         const order = [0, 1, 2].sort((p, q) => logs[q]! - logs[p]!)
         const cap = logs[order[1]!]! + Math.log(rule.maxNeedle)
         if (logs[order[0]!]! > cap) data[b + order[0]!] = cap
      }
   })
   return { n: keep.length, data, camera: null, sh, shCount: s.shCount }
}

export type ViewScore = { name: string; psnr: number; ssim: number }

export async function scoreViews(s: TrainedSplat, colmap: Colmap, imagesDir: string, names: string[], shots?: { dir: string; names: Set<string> }): Promise<ViewScore[]> {
   const byName = new Map(colmap.images.map((i) => [i.name, i]))
   const out: ViewScore[] = []
   for (const name of names) {
      const img = byName.get(name)
      if (img == null) throw new Error(`scoreViews: no camera for ${name}`)
      const truth = await readRgb(join(imagesDir, name))
      const view = renderView(s, colmap.camera, img)
      out.push({ name, psnr: psnr(view, truth.rgb), ssim: ssim(view, truth.rgb, truth.width, truth.height) })
      if (shots?.names.has(name) === true) await writeRgb(join(shots.dir, name), view, truth.width, truth.height)
   }
   return out
}

const mean = (xs: number[]) => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length)

/** mean scores of a set of views, all and per clip (an image named c<k>-…) */
export function summarize(scores: ViewScore[]): Record<string, { n: number; psnr: number; ssim: number }> {
   const groups = new Map<string, ViewScore[]>([['all', scores]])
   for (const v of scores) {
      const clip = /^c(\d+)-/.exec(v.name)?.[1] ?? '?'
      groups.set(`clip ${clip}`, [...(groups.get(`clip ${clip}`) ?? []), v])
   }
   const r: Record<string, { n: number; psnr: number; ssim: number }> = {}
   for (const [k, vs] of groups)
      r[k] = { n: vs.length, psnr: Number(mean(vs.map((v) => v.psnr)).toFixed(2)), ssim: Number(mean(vs.map((v) => v.ssim)).toFixed(3)) }
   return r
}

if (import.meta.main) {
   const args = process.argv.slice(2)
   const flag = (name: string) => {
      const i = args.indexOf(name)
      return i < 0 ? undefined : args.splice(i, 2)[1]
   }
   const outDir = flag('--out')
   const shotNames = flag('--shots')
   const pruneSeen = flag('--prune-seen')
   const pruneNeedle = flag('--prune-needle')
   const [plyPath, colmapDir, splitPath] = args
   if (plyPath == null || colmapDir == null || splitPath == null)
      throw new Error('usage: bun examples/rvion/splatEval.ts <trained.ply> <colmap dir> <split.json> [--out dir] [--shots a.png,b.png] [--prune-seen n] [--prune-needle r]')
   const t0 = performance.now()
   const colmap = readColmap(join(colmapDir, 'sparse', '0'))
   const split = JSON.parse(readFileSync(splitPath, 'utf8')) as { heldout: string[]; train: string[]; trainCheck?: string[] }
   const byName = new Map(colmap.images.map((i) => [i.name, i]))
   const trainImages = split.train.map((n) => byName.get(n)).filter((i) => i != null)
   let splat = readTrained(new Uint8Array(readFileSync(plyPath)))
   let seen = seenBy(splat, colmap.camera, trainImages)
   const before = splatShape(splat, seen)
   if (pruneSeen != null || pruneNeedle != null) {
      splat = prune(splat, seen, { minSeen: pruneSeen == null ? undefined : Number(pruneSeen), maxNeedle: pruneNeedle == null ? undefined : Number(pruneNeedle) })
      seen = seenBy(splat, colmap.camera, trainImages)
   }
   const shape = splatShape(splat, seen)
   if (outDir != null) mkdirSync(outDir, { recursive: true })
   const shots = outDir != null && shotNames != null ? { dir: outDir, names: new Set(shotNames.split(',')) } : undefined
   const imagesDir = join(colmapDir, 'images')
   const heldout = await scoreViews(splat, colmap, imagesDir, split.heldout, shots)
   const train = await scoreViews(splat, colmap, imagesDir, split.trainCheck ?? [], shots)
   const report = { ply: plyPath, shapeBeforePrune: before, shape, heldout: summarize(heldout), train: summarize(train), views: { heldout, train }, seconds: Math.round((performance.now() - t0) / 1000) }
   if (outDir != null) {
      writeFileSync(join(outDir, 'eval.json'), JSON.stringify(report, null, 1))
      if (pruneSeen != null || pruneNeedle != null) writeFileSync(join(outDir, 'pruned.ply'), writeTrained(splat))
   }
   console.log(JSON.stringify({ shapeBeforePrune: before, shape, heldout: report.heldout, train: report.train, seconds: report.seconds }, null, 1))
}
