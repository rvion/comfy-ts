// fly into a picture: MoGe measures the picture's depth and turns it into a textured mesh, a camera
// moves through that mesh along a path we choose (a walk, or round a thing), and every step is
// rendered. That render, with holes where the picture never looked, guides the video model: Wan 2.2
// Fun Control (14B, two stages, the 4-step lightx2v LoRAs), or MiniMax H3 with its Fun ControlNet
// (the 4-step turbo LoRA). The picture is the first frame, the render the control video, and the
// video is the camera move with the holes filled. The camera of each frame is known, so the clip
// can be fitted back into a 3D world. Videos persist on the host under comfy-ts-example/.
//
// run directly:  bun examples/rvion/19-flythrough.cflow.ts [path/to/image.png] [seed]
import { ComfyTS, exampleImagePath, v } from 'comfy-ts'
import { clipFrames, ENGINES, frameFovY, pathCameras } from './flythroughPath.ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1' })
await host.loadSchemaFromCache()

/** Wan 2.2's own negative prompt (the Fun Control template), plus the camera moves we do not want */
const NEGATIVE =
   '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走'
const need = <T,>(x: T | undefined, what: string): T => {
   if (x == null) throw new Error(`flythrough: ${what}`)
   return x
}
/** BatchCameras takes at most this many cameras per node; longer paths nest batches */
const BATCH_MAX = 50

const image = v.image(exampleImagePath('walrus_1344x768.jpg'), {
   presets: {
      walrus: exampleImagePath('walrus_1344x768.jpg'),
      bear: exampleImagePath('bear_1024x1024.jpg'),
      deer: exampleImagePath('deer_768x1344.jpg'),
   },
})
/** the frame the video model makes; it shows the picture's own size as a pick */
const frameSize = v.size({ width: 832, height: 480 }, { image })
/** where a chained clip starts: the last frame of the clip before it; empty = the picture. Not a
 * workflow var (an empty media var fails the run): the script that chains the clips sets it */
export const chainStart = v.image('')
/** a guide video drawn elsewhere (flythroughChain.ts draws it on this machine, in milliseconds a
 * frame): when set, the box skips MoGe and its ray traced render. Not a workflow var, as chainStart */
export const premadeGuide = v.video('')
/** with premadeGuide: the colour render and its coverage (white where the mesh has data), for H3's
 * keep mode */
export const premadeRender = v.video('')
export const premadeCoverage = v.video('')

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
      /** clips the path is cut into, each `seconds` long, chained by their last frame */
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
      /** orbit: the aimed thing's row in the picture, 0 = top edge, 1 = bottom edge */
      aimRow: v.float(0.5, { min: 0, max: 1 }),
      /** orbit: metres from the picture's camera to the aimed thing's centre, along its ray */
      aimDistance: v.float(8, { min: 0.5, max: 100 }),
      /** orbit: metres from that centre the camera circles at */
      radius: v.float(4, { min: 0.2, max: 50 }),
      /** orbit: degrees around it, positive = round by the right */
      sweep: v.float(180, { min: -720, max: 720 }),
      /** degrees the picture looks down at its floor (a picture's mesh measures it): the orbit circles
       * round the floor's vertical. Needs the guide drawn on this machine (flythroughChain.ts), which
       * levels the mesh by it */
      pitch: v.float(0, { min: -80, max: 80 }),
      /** the video model: Wan 2.2 Fun Control 14B (16 fps), or MiniMax H3 with its Fun ControlNet (24 fps) */
      engine: v.choice(['wan', 'h3'], 'wan'),
      /** seconds of one clip, snapped to the frame counts the engine takes */
      seconds: v.float(5, { min: 1, max: 15 }),
      size: frameSize,
      /** what steers the video: the depth of the render (what Fun Control was trained on) or its colours */
      guide: v.choice(['depth', 'color'], 'depth'),
      /** the guide's holes (what the picture never showed): black, or filled with the depth around them
       * (the guide drawn on this machine only): a video model that follows its guide closely paints
       * a black hole as a black void */
      holes: v.choice(['black', 'filled'], 'black'),
      /** the guide render's size against the frame: 0.5 renders four times faster */
      guideScale: v.float(0.5, { min: 0.25, max: 1 }),
      seed: v.seed(42),
      /** sampling steps; Wan runs the first half on its high noise model */
      steps: v.int(4, { min: 2, max: 40 }),
      /** Wan: 1 with the 4-step LoRAs; raise it (with more steps) when they are off */
      cfg: v.float(1, { min: 1, max: 8 }),
      lightning: v.toggle(true, '4-step LoRAs'),
      /** H3: how hard its Fun ControlNet holds the guide */
      control: v.float(1, { min: 0, max: 2 }),
      /** H3: the share of the sampling steps the guide steers, from the first: below 1 the last steps
       * paint freely over the layout it set */
      controlEnd: v.float(1, { min: 0.05, max: 1 }),
      /** H3: control = the guide steers everything; keep = the render's pixels stay where the mesh
       * has data and only the holes are made (its ControlNet's mask and source video) */
      h3Mode: v.choice(['control', 'keep'], 'control'),
      /** H3: how the picture conditions the clip. frame = the start frame alone (the picture, or the
       * last frame of the clip before); reference = the picture also as a reference image every clip
       * (its look held beyond frame 0), the start frame anchored at frame 0 */
      h3Look: v.choice(['frame', 'reference'], 'frame'),
   },
   build: async (b, vars, wf) => {
      const picture = await image.loadInWorkflow(wf)
      const source = frameSize.imageSize()
      if (source == null) throw new Error(`flythrough: cannot read the size of the picture '${image.value}'`)
      const size = vars.size
      const step = vars.engine === 'wan' ? 16 : 32
      if (size.width % step !== 0 || size.height % step !== 0)
         throw new Error(`flythrough: ${vars.engine} needs a size in multiples of ${step}, got ${size.width}×${size.height}`)
      const length = clipFrames(vars.engine, vars.seconds)
      const fps = ENGINES[vars.engine].fps
      const fov = frameFovY({ picture: source, fovX: vars.fov, size })
      if (vars.clip >= vars.clips) throw new Error(`flythrough: clip ${vars.clip} of a path of ${vars.clips} clips`)
      // chained clips start from the last frame of the clip before; the mesh stays the picture's
      // cover-cropped to the frame: H3 stretches a first frame of another shape, and the guide's
      // cameras see the cropped picture (frameFovY)
      const reference = b.ImageScale({
         image: chainStart.isSet() ? await chainStart.loadInWorkflow(wf) : picture,
         upscale_method: 'lanczos',
         width: size.width,
         height: size.height,
         crop: 'center',
      })

      const save = (images: Comfy.Windows1.Accepts['IMAGE'], tag: string) =>
         b.SaveVideo(
            {
               video: b.CreateVideo({ images, fps }),
               filename_prefix: `comfy-ts-example/flythrough-${tag}`,
               format: 'mp4',
               codec: 'h264',
            },
            { tag },
         )
      // the guide: the picture as a textured mesh, rendered from every camera of the path; drawn on
      // this machine by the chain script (premadeGuide), or here by the box (MoGe, then RenderMesh)
      const boxGuide = () => {
         if (vars.pitch !== 0) throw new Error('flythrough: a pitched path needs the guide drawn by flythroughChain.ts, which levels the mesh')
         const geometry = b.MoGeInference({
            moge_model: b.LoadMoGeModel({ model_name: 'moge_2_vitl_normal_fp16.safetensors' }),
            image: picture,
            fov_x_degrees: vars.fov,
         })
         const mesh = b.MoGePointMapToMesh({ moge_geometry: geometry })
         const first = vars.clip * (length - 1)
         const cameras = pathCameras({ ...vars, fovX: vars.fov, aspect: source.height / source.width, length })
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
         // what a reconstruction needs beside the clip: the guide, the render in colour, and its holes
         save(control.outputs.image, 'guide')
         if (vars.guide === 'depth') save(colour.outputs.image, 'render')
         save(b.MaskToImage({ mask: colour.outputs.mask }), 'coverage')
         return { control: control.outputs.image, render: colour.outputs.image, holes: b.InvertMask({ mask: colour.outputs.mask }) }
      }
      const frames = async (video: typeof premadeGuide) => b.GetVideoComponents({ video: await video.loadInWorkflow(wf) }).outputs.images
      const premade = async () => ({
         control: await frames(premadeGuide),
         render: premadeRender.isSet() ? await frames(premadeRender) : undefined,
         holes: premadeCoverage.isSet()
            ? b.InvertMask({ mask: b.ImageToMask({ image: await frames(premadeCoverage), channel: 'red' }) })
            : undefined,
      })
      const guide = premadeGuide.isSet() ? await premade() : boxGuide()
      const control = guide.control

      if (vars.engine === 'h3') {
         // MiniMax H3: the first frame and the prompt condition the clip, its Fun ControlNet patches
         // the model with the guide; one sampler, 4 steps with the turbo LoRA (its own template's graph)
         const vae = b.VAELoader({ vae_name: 'minimax_h3_video_vae_fp16.safetensors' })
         const unet = b.UNETLoader({ unet_name: 'minimax_h3_fl2va_pruned_fp8_scaled.safetensors', weight_dtype: 'default' })
         const base = vars.lightning
            ? b.LoraLoaderModelOnly({ model: unet, lora_name: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors', strength_model: 1 })
            : unet
         const model = b.MiniMaxH3FunControlNetApply({
            model: base,
            model_patch: b.ModelPatchLoader({ name: 'minimax_h3_fun_controlnet_union_2.0_pruned_int8_convrot.safetensors' }),
            vae,
            strength: vars.control,
            end_percent: vars.controlEnd,
            control_video: control,
            ...(vars.h3Mode === 'keep' ? { mask: need(guide.holes, 'h3 keep mode needs the coverage'), source_video: need(guide.render, 'h3 keep mode needs the colour render') } : {}),
         })
         const clip = b.CLIPLoader({ clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', type: 'minimax' })
         const start =
            vars.h3Look === 'reference'
               ? b.MiniMaxH3ReferenceToVideo({
                    clip,
                    vae,
                    prompt: vars.prompt.positive,
                    width: size.width,
                    height: size.height,
                    length,
                    'ref_images.ref_image_0': b.ImageScale({ image: picture, upscale_method: 'lanczos', width: size.width, height: size.height, crop: 'center' }),
                 })
               : b.MiniMaxH3ImageToVideo({ clip, vae, prompt: vars.prompt.positive, width: size.width, height: size.height, length, first_frame: reference })
         const positive =
            vars.h3Look === 'reference'
               ? b.MiniMaxH3AddGuide({ positive: start.outputs.positive, latent: start.outputs.LATENT, vae, image: reference, frame_idx: 0 }).outputs.positive
               : start.outputs.positive
         const sampled = b.SamplerCustomAdvanced({
            noise: b.RandomNoise({ noise_seed: vars.seed }),
            guider: b.BasicGuider({ model, conditioning: positive }),
            sampler: b.KSamplerSelect({ sampler_name: 'res_multistep' }),
            sigmas: b.BasicScheduler({ model, scheduler: 'simple', steps: vars.steps, denoise: 1 }),
            latent_image: start.outputs.LATENT,
         })
         save(b.VAEDecode({ samples: sampled.outputs.output, vae }), 'clip')
         return
      }

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
