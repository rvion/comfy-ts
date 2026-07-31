// wan22 i2v on Comfy Cloud — Wan 2.2 14B image to video, two experts: high noise then low noise, 5s @ 16fps
// source template: video_wan2_2_14B_i2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: video outputs PERSIST on the host (upstream ships no websocket saver for video — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/wan22-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('lioness_768x768.jpg'))

export const wan22I2v = host.defineWorkflow({
   id: 'wan22-i2v',
   vars: {
      image,
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'The white dragon warrior stands still, eyes full of determination and strength. The camera slowly moves closer or circles around the warrior, highlighting the powerful presence and heroic spirit of the character.\n- 色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      length: v.int(81, { min: 1, max: 321 }),
      fps: v.int(16, { min: 1, max: 60 }),
   },
   // async build: the start image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const clip = b.CLIPLoader({ clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'wan_2.1_vae.safetensors' })
      // wan2.2 14B is a mixture of two experts: the high-noise model denoises the
      // template's switchable lightx2v 4-step fast lora branch ships off, dropped here
      // first half of the steps, the low-noise model finishes (shift 5 on both)
      const highModel = b.ModelSamplingSD3({
         model: b.UNETLoader({
            unet_name: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
            weight_dtype: 'default',
         }),
         shift: 5,
      })
      const lowModel = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', weight_dtype: 'default' }),
         shift: 5,
      })
      // conditioning + start-image latent come pre-packaged from the same node
      const video = b.WanImageToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae,
         width: 640,
         height: 640,
         length: vars.length,
         batch_size: 1,
         start_image: loaded,
      })
      const mid = Math.floor(vars.steps / 2)
      const stage1 = b.KSamplerAdvanced({
         model: highModel,
         positive: video.outputs.positive,
         negative: video.outputs.negative,
         latent_image: video.outputs.latent,
         add_noise: 'enable',
         noise_seed: vars.seed,
         steps: vars.steps,
         cfg: 3.5,
         sampler_name: 'euler',
         scheduler: 'simple',
         start_at_step: 0,
         end_at_step: mid,
         return_with_leftover_noise: 'enable',
      })
      const samples = b.KSamplerAdvanced({
         model: lowModel,
         positive: video.outputs.positive,
         negative: video.outputs.negative,
         latent_image: stage1,
         add_noise: 'disable',
         noise_seed: 0,
         steps: vars.steps,
         cfg: 3.5,
         sampler_name: 'euler',
         scheduler: 'simple',
         start_at_step: mid,
         end_at_step: vars.steps,
         return_with_leftover_noise: 'disable',
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples, vae }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/wan22-i2v',
      })
   },
})

export default wan22I2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) wan22I2v.vars.image.set(process.argv[2])
   if (process.argv[3]) wan22I2v.vars.prompt.set(process.argv[3])
   const execution = await wan22I2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/wan22-i2v`)
   host.disconnect()
}
