// 3D gaussians in the binary ply layout of 3DGS (x y z, f_dc_0..2, opacity, scale_0..2, rot_0..3), plus the
// camera elements SHARP writes after the vertices (intrinsic, image_size): the world viewer frames a splat with them
import { readFileSync, writeFileSync } from 'node:fs'

/** the fields of one gaussian, in the order a 3DGS ply stores them */
export const FIELDS = [
   'x', 'y', 'z',
   'f_dc_0', 'f_dc_1', 'f_dc_2',
   'opacity',
   'scale_0', 'scale_1', 'scale_2',
   'rot_0', 'rot_1', 'rot_2', 'rot_3',
] as const
export const STRIDE = FIELDS.length
/** field offsets inside one gaussian's row */
export const F = { x: 0, dc: 3, opacity: 6, scale: 7, rot: 10 } as const

/** the pinhole a splat was made for: focal and principal point in pixels, image size */
export type SplatCamera = { f: number; cx: number; cy: number; width: number; height: number }

/** n gaussians, STRIDE floats each (raw ply values: sh dc color, opacity logit, log scales, quaternion w x y z) */
export type Splat = { n: number; data: Float32Array; camera: SplatCamera | null }

const SIZES: Record<string, number> = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, float32: 4, double: 8 }

type Prop = { name: string; type: string }
type Element = { name: string; count: number; props: Prop[] }

function readValue(view: DataView, at: number, type: string): number {
   switch (type) {
      case 'float':
      case 'float32':
         return view.getFloat32(at, true)
      case 'double':
         return view.getFloat64(at, true)
      case 'uint':
         return view.getUint32(at, true)
      case 'int':
         return view.getInt32(at, true)
      case 'uchar':
      case 'uint8':
         return view.getUint8(at)
      case 'char':
      case 'int8':
         return view.getInt8(at)
      case 'ushort':
         return view.getUint16(at, true)
      case 'short':
         return view.getInt16(at, true)
      default:
         throw new Error(`ply: unknown property type '${type}'`)
   }
}

export function parseSplat(bytes: Uint8Array): Splat {
   const marker = 'end_header\n'
   const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 16384))).toString('latin1')
   const end = head.indexOf(marker)
   if (!head.startsWith('ply\n') || end < 0) throw new Error('ply: no header')
   const lines = head.slice(0, end).split('\n')
   if (!lines.some((l) => l.trim() === 'format binary_little_endian 1.0'))
      throw new Error('ply: only binary_little_endian is read')
   const elements: Element[] = []
   for (const line of lines) {
      const w = line.trim().split(/\s+/)
      if (w[0] === 'element') elements.push({ name: String(w[1]), count: Number(w[2]), props: [] })
      else if (w[0] === 'property') {
         const el = elements[elements.length - 1]
         if (el == null) throw new Error('ply: property before any element')
         if (w[1] === 'list') throw new Error('ply: list properties are not read')
         el.props.push({ type: String(w[1]), name: String(w[2]) })
      }
   }
   const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
   let at = end + marker.length
   let splat: { n: number; data: Float32Array } | null = null
   const scalars = new Map<string, number[]>()
   for (const el of elements) {
      const offsets: number[] = []
      let stride = 0
      for (const p of el.props) {
         const size = SIZES[p.type]
         if (size == null) throw new Error(`ply: unknown property type '${p.type}'`)
         offsets.push(stride)
         stride += size
      }
      if (el.name === 'vertex') {
         const src = FIELDS.map((name) => {
            const i = el.props.findIndex((p) => p.name === name)
            if (i < 0) throw new Error(`ply: vertex has no '${name}': not a 3D gaussian splat`)
            const prop = el.props[i]
            if (prop?.type !== 'float' && prop?.type !== 'float32') throw new Error(`ply: '${name}' is not a float`)
            return offsets[i] ?? 0
         })
         const data = new Float32Array(el.count * STRIDE)
         for (let g = 0; g < el.count; g++) {
            const row = at + g * stride
            for (let k = 0; k < STRIDE; k++) data[g * STRIDE + k] = view.getFloat32(row + (src[k] ?? 0), true)
         }
         splat = { n: el.count, data }
      } else if (el.props.length === 1) {
         const prop = el.props[0]
         if (prop != null) {
            const values: number[] = []
            for (let i = 0; i < el.count; i++) values.push(readValue(view, at + i * stride, prop.type))
            scalars.set(el.name, values)
         }
      }
      at += el.count * stride
   }
   if (splat == null) throw new Error('ply: no vertex element')
   if (at > bytes.length) throw new Error(`ply: truncated (${bytes.length} bytes, the header needs ${at})`)
   const intr = scalars.get('intrinsic')
   const size = scalars.get('image_size')
   const camera =
      intr != null && intr.length === 9 && size != null && size.length === 2
         ? { f: intr[0] ?? 0, cx: intr[2] ?? 0, cy: intr[5] ?? 0, width: size[0] ?? 0, height: size[1] ?? 0 }
         : null
   return { ...splat, camera }
}

export function readSplat(path: string): Splat {
   return parseSplat(readFileSync(path))
}

/** the binary ply: the gaussians, then the camera as SHARP writes it (identity extrinsic) when there is one */
export function encodeSplat(s: Splat): Uint8Array {
   if (s.data.length !== s.n * STRIDE) throw new Error(`ply: ${s.n} gaussians need ${s.n * STRIDE} floats, got ${s.data.length}`)
   const head = ['ply', 'format binary_little_endian 1.0', `element vertex ${s.n}`, ...FIELDS.map((f) => `property float ${f}`)]
   const c = s.camera
   if (c != null)
      head.push('element extrinsic 16', 'property float extrinsic', 'element intrinsic 9', 'property float intrinsic', 'element image_size 2', 'property uint image_size')
   head.push('end_header', '')
   const header = Buffer.from(head.join('\n'), 'latin1')
   const tail = c == null ? 0 : 16 * 4 + 9 * 4 + 2 * 4
   const out = new Uint8Array(header.length + s.data.byteLength + tail)
   out.set(header, 0)
   const view = new DataView(out.buffer)
   let at = header.length
   for (let i = 0; i < s.data.length; i++, at += 4) view.setFloat32(at, s.data[i] ?? 0, true)
   if (c != null) {
      for (let i = 0; i < 16; i++, at += 4) view.setFloat32(at, i % 5 === 0 ? 1 : 0, true)
      for (const v of [c.f, 0, c.cx, 0, c.f, c.cy, 0, 0, 1]) {
         view.setFloat32(at, v, true)
         at += 4
      }
      view.setUint32(at, c.width, true)
      view.setUint32(at + 4, c.height, true)
   }
   return out
}

export function writeSplat(path: string, s: Splat): void {
   writeFileSync(path, encodeSplat(s))
}

/** one splat after the other; the first one's camera stays */
export function concatSplats(parts: Splat[]): Splat {
   const n = parts.reduce((a, p) => a + p.n, 0)
   const data = new Float32Array(n * STRIDE)
   let at = 0
   for (const p of parts) {
      data.set(p.data, at)
      at += p.data.length
   }
   return { n, data, camera: parts[0]?.camera ?? null }
}
