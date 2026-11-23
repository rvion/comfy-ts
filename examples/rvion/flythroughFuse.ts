// a fly-through back into 3D: MoGe (or DA3) measures the depth of every few frames of the clips (on
// the box), each frame's depth is scaled to the frame before it (the first to the picture's own mesh)
// where they overlap, set at the camera we chose for it, and all of them become one cloud of
// small gaussians (a 3DGS ply the world viewers open). Wider than one viewpoint: what the video
// model invented beyond the picture gets a place too. Reads what flythroughChain.ts wrote into <out>.
//
// run:  bun examples/rvion/flythroughFuse.ts <out> [every] [points] [moge|da3]
// writes <out>/fused.ply and <out>/fuse.json (each frame's scale and how much of it the guide covered)
import { $ } from 'bun'
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import sharp from 'sharp'
import { ComfyTS, v } from 'comfy-ts'
import { dropStretched, readGlb, renderGuideFrame, type GuideMesh } from './flythroughGuide.ts'
import type { PathCamera } from './flythroughPath.ts'

/** a frame's mesh (its camera space: y up, -z ahead) scaled, turned to the camera's heading and moved there */
export function placeMesh(positions: Float32Array, scale: number, camera: PathCamera): Float32Array {
   const fx = camera.target[0] - camera.position[0]
   const fz = camera.target[2] - camera.position[2]
   const psi = Math.atan2(fx, -fz)
   const c = Math.cos(psi)
   const s = Math.sin(psi)
   const out = new Float32Array(positions.length)
   for (let i = 0; i < out.length; i += 3) {
      const x = positions[i]! * scale
      const y = positions[i + 1]! * scale
      const z = positions[i + 2]! * scale
      out[i] = c * x - s * z + camera.position[0]
      out[i + 1] = y + camera.position[1]
      out[i + 2] = s * x + c * z + camera.position[2]
   }
   return out
}

/** points as a 3DGS ply: each a small round gaussian of its colour */
export function gaussianPly(p: { xyz: number[]; rgb: number[]; size: number }): Uint8Array {
   const n = p.xyz.length / 3
   const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
   const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n${props.map((x) => `property float ${x}`).join('\n')}\nend_header\n`
   const head = new TextEncoder().encode(header)
   const body = new Float32Array(n * props.length)
   const SH0 = 0.28209479177387814
   const logScale = Math.log(p.size)
   for (let i = 0; i < n; i++) {
      const o = i * props.length
      body.set([p.xyz[i * 3]!, p.xyz[i * 3 + 1]!, p.xyz[i * 3 + 2]!], o)
      for (let c = 0; c < 3; c++) body[o + 3 + c] = (p.rgb[i * 3 + c]! / 255 - 0.5) / SH0
      body[o + 6] = 4.6 // opacity logit: 0.99
      body.set([logScale, logScale, logScale, 1, 0, 0, 0], o + 7)
   }
   const out = new Uint8Array(head.length + body.byteLength)
   out.set(head)
   out.set(new Uint8Array(body.buffer), head.length)
   return out
}

const loadMesh = async (bytes: Uint8Array): Promise<GuideMesh> => {
   const g = readGlb(bytes)
   const t = await sharp(g.textureBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
   return { ...g, positions: new Float32Array(g.positions), texture: { width: t.info.width, height: t.info.height, rgb: new Uint8Array(t.data) } }
}

if (import.meta.main) {
   const [out, everyArg, pointsArg, depthArg] = process.argv.slice(2)
   if (out == null) throw new Error('usage: bun examples/rvion/flythroughFuse.ts <out> [every] [points] [moge|da3]')
   const depthModel = depthArg ?? 'moge'
   if (depthModel !== 'moge' && depthModel !== 'da3') throw new Error(`fuse: depth model '${depthModel}', not moge or da3`)
   const every = Number(everyArg ?? 10)
   const budget = Number(pointsArg ?? 1_500_000)
   const rig = JSON.parse(readFileSync(join(out, 'cameras.json'), 'utf8')) as {
      fovY: number
      width: number
      height: number
      length: number
      cameras: PathCamera[]
   }
   const fovX = (2 * Math.atan((Math.tan((rig.fovY * Math.PI) / 360) * rig.width) / rig.height) * 180) / Math.PI

   // the frames, and the camera of each
   const frames: { file: string; camera: PathCamera; index: number }[] = []
   const framesDir = join(out, 'fuse-frames')
   mkdirSync(framesDir, { recursive: true })
   for (let k = 0; existsSync(join(out, `clip-${k}.mp4`)); k++) {
      await $`ffmpeg -loglevel error -y -i ${join(out, `clip-${k}.mp4`)} ${join(framesDir, `c${k}-%04d.png`)}`
      for (let j = k === 0 ? 0 : every; j < rig.length; j += every) {
         const index = k * (rig.length - 1) + j
         const camera = rig.cameras[index]
         if (camera != null) frames.push({ file: join(framesDir, `c${k}-${String(j + 1).padStart(4, '0')}.png`), camera, index })
      }
   }

   // depth of every frame, one prompt, one glb each, kept in <out>/fuse-meshes so a new fusion
   // costs no box time
   const meshesDir = join(out, 'fuse-meshes')
   mkdirSync(meshesDir, { recursive: true })
   const cached = (i: number) => join(meshesDir, `${depthModel}-${frames[i]!.index}.glb`)
   const missing = frames.map((_, i) => i).filter((i) => !existsSync(cached(i)))
   if (missing.length > 0) {
      const host = ComfyTS.create().host({ id: 'windows-1' })
      await host.loadSchemaFromCache()
      const inputs = missing.map((i) => v.image(frames[i]!.file))
      const measure = host.defineWorkflow({
         id: 'flythrough-fuse',
         vars: {},
         build: async (b, _vars, wf) => {
            // one loader each, made on first use
            let mogeModel: ReturnType<typeof b.LoadMoGeModel> | undefined
            let da3Model: ReturnType<typeof b.LoadDA3Model> | undefined
            const moge = () => (mogeModel ??= b.LoadMoGeModel({ model_name: 'moge_2_vitl_normal_fp16.safetensors' }))
            const da3 = () => (da3Model ??= b.LoadDA3Model({ model_name: 'depth_anything_3_mono_large.safetensors' }))
            for (const [j, input] of inputs.entries()) {
               const image = await input.loadInWorkflow(wf)
               const mesh =
                  depthModel === 'moge'
                     ? b.MoGePointMapToMesh({
                          moge_geometry: b.MoGeInference({ moge_model: moge(), image, fov_x_degrees: fovX, resolution_level: 6 }),
                          decimation: 2,
                       })
                     : b.DA3GeometryToMesh({
                          // DA3's mono model knows no field of view: it unprojects at about 60°
                          da3_geometry: b.DA3Inference({ da3_model: da3(), image, mode: 'mono' }),
                          decimation: 2,
                       })
               b.SaveGLB({ mesh, filename_prefix: 'comfy-ts-example/flythrough-fuse' }, { tag: `frame-${missing[j]}` })
            }
         },
      })
      const t0 = Date.now()
      const measured = await measure.run({})
      console.log(`🟢 ${depthModel} on ${missing.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
      host.disconnect()
      for (const i of missing) {
         const glb = measured.models3d.find((m) => m.tags.includes(`frame-${i}`))
         if (glb == null) throw new Error(`fuse: no mesh came back for frame ${frames[i]!.index}`)
         writeFileSync(cached(i), glb.bytes)
      }
   }

   // scale: the first frame to the picture's mesh (the guide), each next one to the frame before it,
   // where they overlap; the picture's mesh is only right near the picture's own view, the frame
   // before is right wherever the camera has just been
   const source = await loadMesh(new Uint8Array(readFileSync(join(out, 'mesh.glb'))))
   const origin: PathCamera = { position: [0, 0, 0], target: [0, 0, -1] }
   const W = Math.round(rig.width / 2)
   const H = Math.round(rig.height / 2)
   const median = (reference: Float32Array, own: Float32Array) => {
      const ratios: number[] = []
      for (let k = 0; k < W * H; k++) if (Number.isFinite(reference[k]!) && Number.isFinite(own[k]!)) ratios.push(reference[k]! / own[k]!)
      ratios.sort((x, y) => x - y)
      return { scale: ratios[Math.floor(ratios.length / 2)] ?? Number.NaN, covered: ratios.length / (W * H) }
   }
   const fused: { mesh: GuideMesh; placed: GuideMesh; scale: number; covered: number; against: string; camera: PathCamera; index: number }[] = []
   for (const [i, f] of frames.entries()) {
      const mesh = dropStretched(await loadMesh(new Uint8Array(readFileSync(cached(i)))), 3)
      const own = renderGuideFrame({ mesh, camera: origin, width: W, height: H, fovY: rig.fovY }).metres
      const before = fused.at(-1)
      const reference = before == null ? source : before.placed
      let fit = median(renderGuideFrame({ mesh: reference, camera: f.camera, width: W, height: H, fovY: rig.fovY }).metres, own)
      let against = before == null ? 'picture' : 'previous'
      if (!(fit.covered > 0.15) && before != null) {
         fit = { scale: before.scale, covered: fit.covered }
         against = 'previous scale'
      }
      if (!Number.isFinite(fit.scale)) throw new Error(`fuse: frame ${f.index} overlaps nothing to set its scale`)
      const placed = { ...mesh, positions: placeMesh(mesh.positions, fit.scale, f.camera) }
      fused.push({ mesh, placed, scale: fit.scale, covered: fit.covered, against, camera: f.camera, index: f.index })
   }

   // the cloud: every frame's vertices, thinned to the budget
   const total = fused.reduce((n, f) => n + f.mesh.positions.length / 3, 0)
   const stride = Math.max(1, Math.ceil(total / budget))
   const xyz: number[] = []
   const rgb: number[] = []
   for (const f of fused) {
      const placed = f.placed.positions
      const tex = f.mesh.texture
      for (let i = 0; i < placed.length / 3; i += stride) {
         const x = placed[i * 3]!
         const y = placed[i * 3 + 1]!
         const z = placed[i * 3 + 2]!
         if (!Number.isFinite(x + y + z)) continue
         const u = Math.round(f.mesh.uvs[i * 2]! * (tex.width - 1))
         const w = Math.round(f.mesh.uvs[i * 2 + 1]! * (tex.height - 1))
         const o = (w * tex.width + u) * 3
         // written in the axes of SHARP's splats (x right, y down, z ahead), as the world viewers expect
         xyz.push(x, -y, -z)
         rgb.push(tex.rgb[o]!, tex.rgb[o + 1]!, tex.rgb[o + 2]!)
      }
   }
   writeFileSync(join(out, 'fused.ply'), gaussianPly({ xyz, rgb, size: 0.03 }))
   writeFileSync(
      join(out, 'fuse.json'),
      JSON.stringify(fused.map((f) => ({ frame: f.index, scale: f.scale, against: f.against, covered: Number(f.covered.toFixed(3)) })), null, 1),
   )
   await $`rm -rf ${framesDir}`
   console.log(`🟢 ${xyz.length / 3} points from ${fused.length} frames: ${join(out, 'fused.ply')}`)
   process.exit(0)
}
