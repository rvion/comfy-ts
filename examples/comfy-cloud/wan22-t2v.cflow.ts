// wan22 t2v on Comfy Cloud — Wan 2.2 14B text to video, two experts: high noise then low noise, 5s @ 16fps
// source template: video_wan2_2_14B_t2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/wan22-t2v.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const wan22T2v = host.defineWorkflow({
   id: 'wan22-t2v',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Beautiful young European woman with honey blonde hair gracefully turning her head back over shoulder, gentle smile, bright eyes looking at camera. Hair flowing in slow motion as she turns. Soft natural lighting, clean background, cinematic slow-motion portrait.\n- 色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(3.5, { min: 0, max: 30 }),
      size: v.size({ width: 640, height: 640 }),
      length: v.int(81, { min: 1, max: 321 }),
      fps: v.int(16, { min: 1, max: 60 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({ clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'wan_2.1_vae.safetensors' })
      // wan2.2 14B is a mixture of two experts: the high-noise model denoises the
      // first half of the steps, the low-noise model finishes (shift 5 on both)
      const highModel = b.ModelSamplingSD3({
         model: b.UNETLoader({
            unet_name: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
            weight_dtype: 'default',
         }),
         shift: 5,
      })
      const lowModel = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors', weight_dtype: 'default' }),
         shift: 5,
      })
      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      const negative = b.CLIPTextEncode({ clip, text: vars.prompt.negative })
      const latent = b.EmptyHunyuanLatentVideo({
         width: vars.size.width,
         height: vars.size.height,
         length: vars.length,
         batch_size: 1,
      })
      const mid = Math.floor(vars.steps / 2)
      const stage1 = b.KSamplerAdvanced({
         model: highModel,
         positive,
         negative,
         latent_image: latent,
         add_noise: 'enable',
         noise_seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         start_at_step: 0,
         end_at_step: mid,
         return_with_leftover_noise: 'enable',
      })
      const samples = b.KSamplerAdvanced({
         model: lowModel,
         positive,
         negative,
         latent_image: stage1,
         add_noise: 'disable',
         noise_seed: 0,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         start_at_step: mid,
         end_at_step: vars.steps,
         return_with_leftover_noise: 'disable',
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples, vae }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/wan22-t2v',
      })
   },
})

export default wan22T2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) wan22T2v.vars.prompt.set(process.argv[2])
   if (process.argv[3]) wan22T2v.vars.seed.set(Number(process.argv[3]))
   const execution = await wan22T2v.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
