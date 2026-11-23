// fly into a picture: MoGe measures the picture's depth and turns it into a textured mesh, a camera
// walks into that mesh along a path we choose (forward, with a turn), and every step is rendered.
// That render, with holes where the picture never looked, guides Wan 2.2 Fun Control (14B, two
// stages, the 4-step lightx2v LoRAs): the picture is its reference, the render its control video.
// The video is the camera move with the holes filled. The guide render is saved beside it, and the
// camera of each frame is known, so the clip can be fitted back into a 3D world.
// Videos persist on the host under comfy-ts-example/.
//
// run directly:  bun examples/rvion/19-flythrough.cflow.ts [path/to/image.png] [seed]
import { ComfyTS, exampleImagePath, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1' })
await host.loadSchemaFromCache()

/** Wan 2.2's own negative prompt (the Fun Control template), plus the camera moves we do not want */
const NEGATIVE =
   '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走'
/** BatchCameras takes at most this many cameras per node; longer paths nest batches */
const BATCH_MAX = 50

const image = v.image(exampleImagePath('walrus_1344x768.jpg'), {
   presets: {
      walrus: exampleImagePath('walrus_1344x768.jpg'),
      bear: exampleImagePath('bear_1024x1024.jpg'),
      deer: exampleImagePath('deer_768x1344.jpg'),
   },
})
/** the frame Wan makes; it shows the picture's own size as a pick */
const frameSize = v.size({ width: 832, height: 480 }, { image })

/** one camera of the walk, in the render's world (three.js: y up, the picture's camera at the
 * origin looking down -z, as MoGe's mesh is placed) */
export type PathCamera = { position: [number, number, number]; target: [number, number, number] }

/**
 * the walk: `distance` metres forward with an eased speed (still at both ends, so frame 0 is the
 * picture), the heading turning `turn` degrees (positive = right) and the eye rising `rise` metres
 * on the same ease. The camera always looks along its heading, one metre ahead
 */
export function walkPath(p: { frames: number; distance: number; turn: number; rise: number }): PathCamera[] {
   const ease = (t: number) => t * t * (3 - 2 * t)
   const out: PathCamera[] = []
   let x = 0
   let z = 0
   let prev = 0
   for (let i = 0; i < p.frames; i++) {
      const s = p.frames === 1 ? 0 : ease(i / (p.frames - 1))
      const heading = (p.turn * s * Math.PI) / 180
      // integrate along the heading at the middle of the step, so a turn bends the path
      const mid = (p.turn * ((s + prev) / 2) * Math.PI) / 180
      x += (s - prev) * p.distance * Math.sin(mid)
      z -= (s - prev) * p.distance * Math.cos(mid)
      prev = s
      const y = p.rise * s
      out.push({ position: [x, y, z], target: [x + Math.sin(heading), y, z - Math.cos(heading)] })
   }
   return out
}

/**
 * around a thing: fly from the picture's camera toward `center` (x, z on the floor of the render's
 * world), bend into a circle of `radius` metres around it and sweep `sweep` degrees (positive = the
 * camera goes round by the right), the eye level and the thing centred. One steady speed over the whole path, eased
 * only at its two ends, so clips cut from it (`frames` per clip, the last frame of one the first of
 * the next) join without a jump
 */
export function orbitPath(p: { frames: number; center: [number, number]; radius: number; sweep: number }): PathCamera[] {
   const [cx, cz] = p.center
   const dist = Math.hypot(cx, cz)
   if (dist <= p.radius) throw new Error(`orbitPath: the camera starts inside the circle (${dist.toFixed(2)} m from its centre, radius ${p.radius} m)`)
   // the circle starts where the line from the centre to the camera meets it
   const phi0 = Math.atan2(-cx, -cz)
   const onCircle = (phi: number): [number, number] => [cx + p.radius * Math.sin(phi), cz + p.radius * Math.cos(phi)]
   const sweep = (p.sweep * Math.PI) / 180
   const dir = Math.sign(sweep) || 1
   // the approach: a cubic curve leaving straight ahead (-z) and landing on the circle along its tangent
   const [ex, ez] = onCircle(phi0)
   const approach = Math.hypot(ex, ez)
   const tangent: [number, number] = [dir * Math.cos(phi0), -dir * Math.sin(phi0)]
   const k = approach / 2.5
   const ctrl: [number, number][] = [[0, 0], [0, -k], [ex - tangent[0] * k, ez - tangent[1] * k], [ex, ez]]
   const bezier = (t: number): [number, number] => {
      const u = 1 - t
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const
      return [0, 1].map((a) => ctrl.reduce((acc, c, i) => acc + w[i]! * c[a]!, 0)) as [number, number]
   }
   // dense samples of the whole path: position, then where it looks
   const samples: { at: [number, number]; look: [number, number] }[] = []
   const N = 4000
   for (let i = 0; i <= N; i++) {
      const t = i / N
      const at = bezier(t)
      // the look turns from straight ahead to the centre over the approach
      const ease = t * t * (3 - 2 * t)
      const ahead: [number, number] = [at[0], at[1] - dist]
      samples.push({ at, look: [ahead[0] + (cx - ahead[0]) * ease, ahead[1] + (cz - ahead[1]) * ease] })
   }
   for (let i = 1; i <= N; i++) samples.push({ at: onCircle(phi0 + (sweep * i) / N), look: [cx, cz] })
   const cum = [0]
   for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!.at
      const b = samples[i]!.at
      cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
   }
   const total = cum.at(-1) ?? 0
   // steady speed, its ramp up and down over the first and last tenth of the path's time
   const ramp = 0.1
   const along = (t: number): number => {
      const v = 1 / (1 - ramp)
      if (t < ramp) return (v * t * t) / (2 * ramp)
      if (t > 1 - ramp) return 1 - (v * (1 - t) * (1 - t)) / (2 * ramp)
      return v * (t - ramp / 2)
   }
   const out: PathCamera[] = []
   let j = 0
   for (let f = 0; f < p.frames; f++) {
      const want = along(p.frames === 1 ? 0 : f / (p.frames - 1)) * total
      while (j < cum.length - 2 && cum[j + 1]! < want) j++
      const a = samples[j]!
      const b = samples[j + 1] ?? a
      const span = cum[j + 1]! - cum[j]!
      const r = span > 0 ? Math.min(1, Math.max(0, (want - cum[j]!) / span)) : 0
      const mix = (x: number, y: number) => x + (y - x) * r
      out.push({
         position: [mix(a.at[0], b.at[0]), 0, mix(a.at[1], b.at[1])],
         target: [mix(a.look[0], b.look[0]), 0, mix(a.look[1], b.look[1])],
      })
   }
   return out
}

/** the vertical field of view of the frame Wan sees: the picture cover-cropped to `size`, its
 * focal length set by its horizontal field of view */
export function frameFovY(p: { picture: { width: number; height: number }; fovX: number; size: { width: number; height: number } }): number {
   const focal = p.picture.width / 2 / Math.tan((p.fovX * Math.PI) / 360)
   const aspect = p.size.width / p.size.height
   const croppedWidth = p.picture.width / p.picture.height > aspect
   const visibleHeight = croppedWidth ? p.picture.height : p.picture.width / aspect
   return (2 * Math.atan(visibleHeight / 2 / focal) * 180) / Math.PI
}

export const flythrough = host.defineWorkflow({
   id: 'flythrough',
   tags: ['video', '3d', 'camera'],
   vars: {
      image,
      prompt: v.prompt(
         'a slow steady camera walks forward into the scene, smooth dolly shot, the same place and the same light, detailed, sharp\n- shaky camera, zoom, cut, morphing, flicker',
      ),
      /** the picture's horizontal field of view in degrees: MoGe builds the mesh with it, the render uses it */
      fov: v.float(60, { min: 20, max: 120 }),
      /** metres forward along the path, in MoGe's metric scale */
      distance: v.float(2.5, { min: 0, max: 20 }),
      /** degrees the heading turns over the walk, positive = to the right */
      turn: v.float(12, { min: -90, max: 90 }),
      /** metres the eye rises over the walk */
      rise: v.float(0, { min: -5, max: 5 }),
      /** frames at 16 fps: 49 = 3 s, 81 = 5 s */
      length: v.int(81, { min: 17, max: 121 }),
      size: frameSize,
      /** what steers Wan: the depth of the render (what Fun Control was trained on) or its colours */
      guide: v.choice(['depth', 'color'], 'depth'),
      /** the guide render's size against the frame: 0.5 renders four times faster */
      guideScale: v.float(0.5, { min: 0.25, max: 1 }),
      seed: v.seed(42),
      /** total steps of the two stages; the first half runs on the high noise model */
      steps: v.int(4, { min: 2, max: 40 }),
      /** 1 with the 4-step LoRAs; raise it (with more steps) when they are off */
      cfg: v.float(1, { min: 1, max: 8 }),
      lightning: v.toggle(true, '4-step LoRAs'),
   },
   build: async (b, vars, wf) => {
      const picture = await image.loadInWorkflow(wf)
      const source = frameSize.imageSize()
      if (source == null) throw new Error(`flythrough: cannot read the size of the picture '${image.value}'`)
      const size = vars.size
      if (size.width % 16 !== 0 || size.height % 16 !== 0)
         throw new Error(`flythrough: Wan needs a size in multiples of 16, got ${size.width}×${size.height}`)
      // the length Wan takes is 4n+1
      const length = Math.floor((vars.length - 1) / 4) * 4 + 1
      const fov = frameFovY({ picture: source, fovX: vars.fov, size })

      // the guide: the picture as a textured mesh, rendered from every camera of the path
      const geometry = b.MoGeInference({
         moge_model: b.LoadMoGeModel({ model_name: 'moge_2_vitl_normal_fp16.safetensors' }),
         image: picture,
         fov_x_degrees: vars.fov,
      })
      const mesh = b.MoGePointMapToMesh({ moge_geometry: geometry })
      const cameras = walkPath({ frames: length, distance: vars.distance, turn: vars.turn, rise: vars.rise }).map((c) =>
         b.CreateCameraInfo({
            mode: 'look_at',
            'mode.position_x': c.position[0],
            'mode.position_y': c.position[1],
            'mode.position_z': c.position[2],
            target_x: c.target[0],
            target_y: c.target[1],
            target_z: c.target[2],
            fov,
            camera_type: 'perspective',
         }),
      )
      const batch = (list: Comfy.Windows1.Accepts['LOAD3D_CAMERA'][]): Comfy.Windows1.Accepts['LOAD3D_CAMERA'] => {
         const [first, ...rest] = list
         if (first == null) throw new Error('flythrough: a camera batch needs one camera at least')
         const more: Record<string, Comfy.Windows1.Accepts['LOAD3D_CAMERA']> = {}
         rest.forEach((cam, i) => (more[`cameras.camera_info${i + 1}`] = cam))
         return b.BatchCameras({ 'cameras.camera_info0': first, ...more })
      }
      const chunks: Comfy.Windows1.Accepts['LOAD3D_CAMERA'][] = []
      for (let i = 0; i < cameras.length; i += BATCH_MAX) chunks.push(batch(cameras.slice(i, i + BATCH_MAX)))
      const path = chunks.length === 1 ? chunks[0] : batch(chunks)
      // the mesh is ray traced frame by frame (seconds a frame at full size): a smaller guide costs a
      // fraction of that, and Wan scales its control video to the frame anyway
      const guideSize = (side: number) => Math.max(64, Math.round((side * vars.guideScale) / 8) * 8)
      const render = (mode: 'texture' | 'depth') =>
         b.RenderMesh({
            mesh,
            mode,
            width: guideSize(size.width),
            height: guideSize(size.height),
            background: '#000000',
            camera_info: path,
         })
      const colour = render('texture')
      const control = vars.guide === 'depth' ? render('depth') : colour
      const save = (images: Comfy.Windows1.Accepts['IMAGE'], tag: string) =>
         b.SaveVideo(
            {
               video: b.CreateVideo({ images, fps: 16 }),
               filename_prefix: `comfy-ts-example/flythrough-${tag}`,
               format: 'mp4',
               codec: 'h264',
            },
            { tag },
         )
      // what a reconstruction needs beside the clip: the guide, the render in colour, and its holes
      save(control.outputs.image, 'guide')
      if (vars.guide === 'depth') save(colour.outputs.image, 'render')
      save(b.MaskToImage({ mask: colour.outputs.mask }), 'coverage')

      // Wan 2.2 Fun Control, two stages: the high noise model lays out the motion, the low noise
      // model the detail
      const clip = b.CLIPLoader({ clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan' })
      const vae = b.VAELoader({ vae_name: 'wan_2.1_vae.safetensors' })
      const stage = (noise: 'high' | 'low') => {
         const unet = b.UNETLoader({ unet_name: `wan2.2_fun_control_${noise}_noise_14B_fp8_scaled.safetensors`, weight_dtype: 'default' })
         const model = vars.lightning
            ? b.LoraLoaderModelOnly({ model: unet, lora_name: `wan2.2_i2v_lightx2v_4steps_lora_v1_${noise}_noise.safetensors`, strength_model: 1 })
            : unet
         return b.ModelSamplingSD3({ model, shift: 8 })
      }
      const conditioning = b.Wan22FunControlToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: `${NEGATIVE}${vars.prompt.negative === '' ? '' : `, ${vars.prompt.negative}`}` }),
         vae,
         width: size.width,
         height: size.height,
         length,
         ref_image: picture,
         control_video: control,
      })
      const split = Math.max(1, Math.floor(vars.steps / 2))
      const sample = (p: { noise: 'high' | 'low'; latent: Comfy.Windows1.Accepts['LATENT']; first: boolean }) =>
         b.KSamplerAdvanced({
            model: stage(p.noise),
            add_noise: p.first ? 'enable' : 'disable',
            noise_seed: vars.seed,
            steps: vars.steps,
            cfg: vars.cfg,
            sampler_name: 'euler',
            scheduler: 'simple',
            positive: conditioning.outputs.positive,
            negative: conditioning.outputs.negative,
            latent_image: p.latent,
            start_at_step: p.first ? 0 : split,
            end_at_step: p.first ? split : 10000,
            return_with_leftover_noise: p.first ? 'enable' : 'disable',
         })
      const high = sample({ noise: 'high', latent: conditioning.outputs.latent, first: true })
      const low = sample({ noise: 'low', latent: high, first: false })
      save(b.VAEDecode({ samples: low, vae }), 'clip')
   },
})

export default flythrough

if (import.meta.main) {
   if (process.argv[2]) flythrough.vars.image.set(process.argv[2])
   if (process.argv[3]) flythrough.vars.seed.set(Number(process.argv[3]))
   const execution = await flythrough.run({ log: true, save: { prefix: 'comfy-ts-example/flythrough' } })
   for (const clip of execution.videos) console.log(`🟢 ${clip.tags.join(',')} ${clip.absPath}`)
   host.disconnect()
}
