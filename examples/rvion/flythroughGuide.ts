// the guide of 19-flythrough drawn on this machine: the picture's MoGe mesh (a glb) rasterized from
// every camera of the path, a colour frame, a depth frame (near = bright, as ComfyUI's RenderMesh) and
// its coverage. A z-buffered triangle rasterizer, perspective correct, in plain TypeScript: about a
// tenth of a second a frame where the box's ray tracer takes seconds
import { levelPoint, type PathCamera } from './flythroughPath.ts'

/** a textured triangle mesh in the render's world (y up, -z ahead) */
export type GuideMesh = {
   positions: Float32Array
   uvs: Float32Array
   indices: Uint32Array
   texture: { width: number; height: number; rgb: Uint8Array }
}

/** `metres`: each pixel's distance along the view axis, Infinity where the mesh has no data */
export type GuideFrame = { color: Uint8Array; depth: Uint8Array; coverage: Uint8Array; metres: Float32Array }

/** the parts of a glb this needs: the first primitive's positions, uvs, indices, and its texture's
 * encoded bytes (decode them with sharp, then pass `texture`) */
export function readGlb(bytes: Uint8Array): Omit<GuideMesh, 'texture'> & { textureBytes: Uint8Array } {
   const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
   if (view.getUint32(0, true) !== 0x46546c67) throw new Error('readGlb: not a glb file')
   let off = 12
   let json: unknown = null
   let bin: Uint8Array = new Uint8Array()
   while (off < bytes.length) {
      const len = view.getUint32(off, true)
      const type = view.getUint32(off + 4, true)
      const chunk = bytes.subarray(off + 8, off + 8 + len)
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk))
      else if (type === 0x004e4942) bin = chunk
      off += 8 + len
   }
   const gltf = json as GltfJson
   const prim = gltf.meshes?.[0]?.primitives?.[0]
   if (prim == null) throw new Error('readGlb: no mesh primitive')
   const view_ = (i: number) => {
      const bv = gltf.bufferViews?.[i]
      if (bv == null) throw new Error(`readGlb: no buffer view ${i}`)
      return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
   }
   const accessor = (i: number | undefined): Uint8Array & { componentType: number; count: number } => {
      const a = i == null ? undefined : gltf.accessors?.[i]
      if (a == null) throw new Error(`readGlb: no accessor ${i}`)
      const raw = view_(a.bufferView).slice(a.byteOffset ?? 0)
      return Object.assign(raw, { componentType: a.componentType, count: a.count })
   }
   const floats = (i: number | undefined, n: number) => {
      const a = accessor(i)
      if (a.componentType !== 5126) throw new Error('readGlb: positions and uvs must be float32')
      return new Float32Array(a.buffer, a.byteOffset, a.count * n)
   }
   const idx = accessor(prim.indices)
   const indices =
      idx.componentType === 5125
         ? new Uint32Array(idx.buffer, idx.byteOffset, idx.count)
         : Uint32Array.from(new Uint16Array(idx.buffer, idx.byteOffset, idx.count))
   const image = gltf.images?.[0]
   if (image?.bufferView == null) throw new Error('readGlb: no embedded texture')
   return {
      positions: floats(prim.attributes.POSITION, 3),
      uvs: floats(prim.attributes.TEXCOORD_0, 2),
      indices,
      textureBytes: view_(image.bufferView),
   }
}

type GltfJson = {
   meshes?: { primitives?: { attributes: { POSITION?: number; TEXCOORD_0?: number }; indices?: number }[] }[]
   accessors?: { bufferView: number; byteOffset?: number; componentType: number; count: number }[]
   bufferViews?: { byteOffset?: number; byteLength: number }[]
   images?: { bufferView?: number }[]
}

/**
 * the mesh without its curtains: a picture's mesh joins a near surface to the far one behind it
 * with long thin triangles, short from the picture's camera (the origin) and long in depth. Seen
 * from the side they stretch into streaks the video model copies, where a hole makes it invent.
 * A triangle goes when an edge is longer than `ratio` times what its angle from the origin spans
 */
export function dropStretched(mesh: GuideMesh, ratio = 4): GuideMesh {
   const P = mesh.positions
   const kept: number[] = []
   const edge = (i: number, j: number) => {
      const ax = P[i * 3]!
      const ay = P[i * 3 + 1]!
      const az = P[i * 3 + 2]!
      const bx = P[j * 3]!
      const by = P[j * 3 + 1]!
      const bz = P[j * 3 + 2]!
      const la = Math.hypot(ax, ay, az)
      const lb = Math.hypot(bx, by, bz)
      // the angle between the two rays from the origin, times the nearer distance: the edge as the
      // picture's camera saw it
      const across = Math.hypot(ax / la - bx / lb, ay / la - by / lb, az / la - bz / lb) * Math.min(la, lb)
      return Math.hypot(ax - bx, ay - by, az - bz) <= ratio * across + 1e-4
   }
   const idx = mesh.indices
   for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!
      const b = idx[t + 1]!
      const c = idx[t + 2]!
      if (edge(a, b) && edge(b, c) && edge(c, a)) kept.push(a, b, c)
   }
   return { ...mesh, indices: Uint32Array.from(kept) }
}

/** the mesh in the path's levelled world: every vertex turned by the picture's `pitch` (levelPoint) */
export function levelMesh(mesh: GuideMesh, pitch: number): GuideMesh {
   if (pitch === 0) return mesh
   const positions = new Float32Array(mesh.positions.length)
   for (let i = 0; i < positions.length; i += 3) {
      const q = levelPoint([mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!], pitch)
      positions.set(q, i)
   }
   return { ...mesh, positions }
}

/** one frame from one camera: `fovY` vertical, degrees; the camera looks at its target, y up */
export function renderGuideFrame(p: { mesh: GuideMesh; camera: PathCamera; width: number; height: number; fovY: number }): GuideFrame {
   const { mesh, camera, width: W, height: H } = p
   const [ex, ey, ez] = camera.position
   // camera axes: forward f, right r, up u (three.js look-at with world up +y)
   let fx = camera.target[0] - ex
   let fy = camera.target[1] - ey
   let fz = camera.target[2] - ez
   const fl = Math.hypot(fx, fy, fz) || 1
   fx /= fl
   fy /= fl
   fz /= fl
   let rx = -fz
   let rz = fx
   const rl = Math.hypot(rx, rz) || 1
   rx /= rl
   rz /= rl
   const ux = -rz * fy
   const uy = rz * fx - rx * fz
   const uz = rx * fy
   const focal = H / 2 / Math.tan((p.fovY * Math.PI) / 360)
   const n = mesh.positions.length / 3
   // every vertex once: screen x, y, its view depth
   const sx = new Float32Array(n)
   const sy = new Float32Array(n)
   const sz = new Float32Array(n)
   for (let i = 0; i < n; i++) {
      const dx = mesh.positions[i * 3]! - ex
      const dy = mesh.positions[i * 3 + 1]! - ey
      const dz = mesh.positions[i * 3 + 2]! - ez
      const z = dx * fx + dy * fy + dz * fz
      sz[i] = z
      sx[i] = W / 2 + (focal * (dx * rx + dz * rz)) / z
      sy[i] = H / 2 - (focal * (dx * ux + dy * uy + dz * uz)) / z
   }
   const zbuf = new Float32Array(W * H).fill(Infinity)
   const ubuf = new Float32Array(W * H)
   const vbuf = new Float32Array(W * H)
   const NEAR = 0.05
   const idx = mesh.indices
   for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!
      const b = idx[t + 1]!
      const c = idx[t + 2]!
      const za = sz[a]!
      const zb = sz[b]!
      const zc = sz[c]!
      // a triangle crossing the near plane is dropped whole: at the guide's scale it is a sliver
      if (za < NEAR || zb < NEAR || zc < NEAR) continue
      const ax = sx[a]!
      const ay = sy[a]!
      const bx = sx[b]!
      const by = sy[b]!
      const cx = sx[c]!
      const cy = sy[c]!
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (area === 0 || !Number.isFinite(area)) continue
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
      const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
      const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)))
      if (x0 > x1 || y0 > y1) continue
      const ia = 1 / za
      const ib = 1 / zb
      const ic = 1 / zc
      for (let y = y0; y <= y1; y++) {
         const py = y + 0.5
         for (let x = x0; x <= x1; x++) {
            const px = x + 0.5
            const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area
            const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area
            const w2 = 1 - w0 - w1
            if (w0 < 0 || w1 < 0 || w2 < 0) continue
            // perspective correct: interpolate 1/z, and uv/z
            const iz = w0 * ia + w1 * ib + w2 * ic
            const z = 1 / iz
            const k = y * W + x
            if (z >= zbuf[k]!) continue
            zbuf[k] = z
            ubuf[k] = (w0 * mesh.uvs[a * 2]! * ia + w1 * mesh.uvs[b * 2]! * ib + w2 * mesh.uvs[c * 2]! * ic) * z
            vbuf[k] = (w0 * mesh.uvs[a * 2 + 1]! * ia + w1 * mesh.uvs[b * 2 + 1]! * ib + w2 * mesh.uvs[c * 2 + 1]! * ic) * z
         }
      }
   }
   const color = new Uint8Array(W * H * 3)
   const depth = new Uint8Array(W * H * 3)
   const coverage = new Uint8Array(W * H * 3)
   let lo = Infinity
   let hi = -Infinity
   for (let k = 0; k < W * H; k++) {
      const z = zbuf[k]!
      if (z === Infinity) continue
      if (z < lo) lo = z
      if (z > hi) hi = z
   }
   const range = Math.max(hi - lo, 1e-6)
   const tex = mesh.texture
   for (let k = 0; k < W * H; k++) {
      const z = zbuf[k]!
      if (z === Infinity) continue
      const tu = Math.min(tex.width - 1, Math.max(0, Math.round(ubuf[k]! * (tex.width - 1))))
      const tv = Math.min(tex.height - 1, Math.max(0, Math.round(vbuf[k]! * (tex.height - 1))))
      const o = (tv * tex.width + tu) * 3
      const d = Math.round(((hi - z) / range) * 255)
      for (let ch = 0; ch < 3; ch++) {
         color[k * 3 + ch] = tex.rgb[o + ch]!
         depth[k * 3 + ch] = d
         coverage[k * 3 + ch] = 255
      }
   }
   return { color, depth, coverage, metres: zbuf }
}
