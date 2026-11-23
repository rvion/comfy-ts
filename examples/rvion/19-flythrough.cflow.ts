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
import { frameFovY, pathCameras } from './flythroughPath.ts'

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
/** where a chained clip starts: the last frame of the clip before it; empty = the picture. Not a
 * workflow var (an empty media var fails the run): the script that chains the clips sets it */
export const chainStart = v.image('')

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
      /** walk: forward with a turn; orbit: toward the aimed thing, then around it */
      path: v.choice(['walk', 'orbit'], 'walk'),
      /** clips the path is cut into, each `length` frames, chained by their last frame */
      clips: v.int(1, { min: 1, max: 16 }),
      /** which clip of the path this run makes, from 0 */
      clip: v.int(0, { min: 0, max: 15 }),
      /** walk: metres forward along the path, in MoGe's metric scale */
      distance: v.float(2.5, { min: 0, max: 20 }),
      /** degrees the heading turns over the walk, positive = to the right */
      turn: v.float(12, { min: -90, max: 90 }),
      /** metres the eye rises over the walk */
      rise: v.float(0, { min: -5, max: 5 }),
      /** orbit: the aimed thing's column in the picture, 0 = left edge, 1 = right edge */
      aim: v.float(0.5, { min: 0, max: 1 }),
      /** orbit: metres from the picture's camera to the aimed thing's centre */
      aimDistance: v.float(8, { min: 0.5, max: 100 }),
      /** orbit: metres from that centre the camera circles at */
      radius: v.float(4, { min: 0.2, max: 50 }),
      /** orbit: degrees around it, positive = round by the right */
      sweep: v.float(180, { min: -720, max: 720 }),
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
      if (vars.clip >= vars.clips) throw new Error(`flythrough: clip ${vars.clip} of a path of ${vars.clips} clips`)
      // chained clips start from the last frame of the clip before; the mesh stays the picture's
      const reference = chainStart.isSet() ? await chainStart.loadInWorkflow(wf) : picture

      // the guide: the picture as a textured mesh, rendered from every camera of the path
      const geometry = b.MoGeInference({
         moge_model: b.LoadMoGeModel({ model_name: 'moge_2_vitl_normal_fp16.safetensors' }),
         image: picture,
         fov_x_degrees: vars.fov,
      })
      const mesh = b.MoGePointMapToMesh({ moge_geometry: geometry })
      const first = vars.clip * (length - 1)
      const cameras = pathCameras({ ...vars, fovX: vars.fov, length })
         .slice(first, first + length)
         .map((c) =>
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
         ref_image: reference,
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
