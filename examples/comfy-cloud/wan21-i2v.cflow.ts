// wan21 i2v on Comfy Cloud — Wan 2.1 14B 480p image to video: start image + CLIP vision steer the motion
// source template: image_to_video_wan.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/wan21-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('dog_512x512.jpg'))

export const wan21I2v = host.defineWorkflow({
   id: 'wan21-i2v',
   vars: {
      image,
      // the `- ` line is the template's own wan negative (standard Chinese quality list)
      prompt: v.prompt(
         'a cute anime girl with massive fennec ears and a big fluffy tail wearing a maid outfit turning around\n- 色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      length: v.int(33, { min: 1, max: 241 }),
      fps: v.int(16, { min: 1, max: 60 }),
   },
   // async build: the start image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'wan2.1_i2v_480p_14B_fp16.safetensors', weight_dtype: 'default' }),
         shift: 8,
      })
      const clip = b.CLIPLoader({ clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'wan_2.1_vae.safetensors' })

      // 512x512 from the template; the model is 480p class
      const wan = b.WanImageToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae,
         width: 512,
         height: 512,
         length: vars.length,
         batch_size: 1,
         clip_vision_output: b.CLIPVisionEncode({
            clip_vision: b.CLIPVisionLoader({ clip_name: 'clip_vision_h.safetensors' }),
            image: loaded,
            crop: 'none',
         }),
         start_image: loaded,
      })

      const samples = b.KSampler({
         model,
         positive: wan.outputs.positive,
         negative: wan.outputs.negative,
         latent_image: wan.outputs.latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: 6,
         sampler_name: 'uni_pc',
         scheduler: 'simple',
         denoise: 1,
      })
      const video = b.CreateVideo({ images: b.VAEDecode({ samples, vae }), fps: vars.fps })
      b.SaveVideo({ video, filename_prefix: 'comfy-ts-zoo/wan21-i2v', format: 'auto', codec: 'auto' })
   },
})

export default wan21I2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) wan21I2v.vars.image.set(process.argv[2])
   if (process.argv[3]) wan21I2v.vars.prompt.set(process.argv[3])
   const execution = await wan21I2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for videos yet)
   console.log(`🟢 ${execution.status} — video saved on the host under comfy-ts-zoo/wan21-i2v`)
   host.disconnect()
}
