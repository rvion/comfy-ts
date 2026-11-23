// a splat trained on a fly-through (Brush, on flythroughColmap.ts's export) into the axes the world
// viewers read, SHARP's: x right, y down, z ahead, the picture's camera. The fly-through's world is
// y up, -z ahead, levelled by the picture's pitch, so every splat turns 180° + pitch about x (at
// pitch 0: positions (x, -y, -z), rotations q' = (0, 1, 0, 0) ⊗ q). The view dependent colour
// (f_rest) is dropped rather than turned: the base colour stays exact.
//
// run:  bun examples/rvion/flythroughSplat.ts <trained.ply> <out.ply> [pitch]
import { readFileSync, writeFileSync } from 'node:fs'

/** a binary 3DGS ply of float properties, its header and one Float32Array row per splat */
export function readSplatPly(bytes: Uint8Array): { names: string[]; count: number; data: Float32Array } {
   const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 65536)))
   const end = head.indexOf('end_header\n')
   if (end < 0) throw new Error('readSplatPly: no end_header')
   const header = head.slice(0, end)
   if (!header.includes('format binary_little_endian')) throw new Error('readSplatPly: not a binary little endian ply')
   const count = Number(/element vertex (\d+)/.exec(header)?.[1] ?? Number.NaN)
   if (!Number.isFinite(count)) throw new Error('readSplatPly: no vertex count')
   const lines = header.split('\n')
   const vertexAt = lines.findIndex((l) => l.startsWith('element vertex'))
   const names: string[] = []
   for (const line of lines.slice(vertexAt + 1)) {
      if (line.startsWith('element')) break
      const m = /^property (\S+) (\S+)$/.exec(line)
      if (m == null) continue
      if (m[1] !== 'float') throw new Error(`readSplatPly: property ${m[2]} is ${m[1]}, only float is read`)
      names.push(m[2]!)
   }
   const start = end + 'end_header\n'.length
   const data = new Float32Array(bytes.slice(start, start + count * names.length * 4).buffer)
   return { names, count, data }
}

/** the turned splats, as a ply with the standard property order; `pitch` the path's (degrees) */
export function toViewerAxes(ply: { names: string[]; count: number; data: Float32Array }, pitch = 0): Uint8Array {
   const angle = Math.PI + (pitch * Math.PI) / 180
   const cos = Math.cos(angle)
   const sin = Math.sin(angle)
   // the turn as a quaternion (w, x): (cos, sin) of the half angle about x
   const hw = Math.cos(angle / 2)
   const hx = Math.sin(angle / 2)
   const at = (name: string) => {
      const i = ply.names.indexOf(name)
      if (i < 0) throw new Error(`toViewerAxes: no property ${name}`)
      return i
   }
   const src = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].map(at)
   const P = ply.names.length
   const out = new Float32Array(ply.count * 14)
   for (let i = 0; i < ply.count; i++) {
      const v = src.map((k) => ply.data[i * P + k]!)
      const [x, y, z, r, g, b, o, s0, s1, s2, w, qx, qy, qz] = v as [number, number, number, number, number, number, number, number, number, number, number, number, number, number]
      // (hw, hx, 0, 0) ⊗ (w, qx, qy, qz)
      const rot = [hw * w - hx * qx, hw * qx + hx * w, hw * qy - hx * qz, hw * qz + hx * qy]
      out.set([x, y * cos - z * sin, y * sin + z * cos, r, g, b, o, s0, s1, s2, ...rot], i * 14)
   }
   const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
   const header = new TextEncoder().encode(
      `ply\nformat binary_little_endian 1.0\nelement vertex ${ply.count}\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`,
   )
   const bytes = new Uint8Array(header.length + out.byteLength)
   bytes.set(header)
   bytes.set(new Uint8Array(out.buffer), header.length)
   return bytes
}

if (import.meta.main) {
   const [input, output, pitch] = process.argv.slice(2)
   if (input == null || output == null) throw new Error('usage: bun examples/rvion/flythroughSplat.ts <trained.ply> <out.ply> [pitch]')
   const ply = readSplatPly(new Uint8Array(readFileSync(input)))
   writeFileSync(output, toViewerAxes(ply, Number(pitch ?? 0)))
   console.log(`🟢 ${ply.count} splats turned to the viewer's axes: ${output}`)
}
