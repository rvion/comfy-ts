// kandinsky5 t2v on Comfy Cloud — Kandinsky 5.0 Lite text to video, 5s @ 24fps (hunyuan video VAE)
// source template: video_kandinsky5_t2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/kandinsky5-t2v.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const kandinsky5T2v = host.defineWorkflow({
   id: 'kandinsky5-t2v',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'a woman with fluffy brown curly hair in a flowing white dress stands before a magnificent stained glass window at sunset, warm low-saturation tones, rim light, medium close-up, colorful light and shadow, cinematic',
      ),
      seed: v.seed(42),
      steps: v.int(50, { min: 1, max: 60 }),
      cfg: v.float(5, { min: 0, max: 30 }),
      size: v.size({ width: 768, height: 512 }),
      length: v.int(121, { min: 1, max: 241 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'kandinsky5lite_t2v_sft_5s.safetensors', weight_dtype: 'default' }),
         shift: 5,
      })
      const clip = b.DualCLIPLoader({
         clip_name1: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         clip_name2: 'clip_l.safetensors',
         type: 'kandinsky5',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'hunyuan_video_vae_bf16.safetensors' })
      // conditioning + empty video latent come pre-packaged from the same node
      const video = b.Kandinsky5ImageToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae,
         width: vars.size.width,
         height: vars.size.height,
         length: vars.length,
         batch_size: 1,
      })
      const samples = b.KSampler({
         model,
         positive: video.outputs.positive,
         negative: video.outputs.negative,
         latent_image: video.outputs.latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler_ancestral',
         scheduler: 'beta',
         denoise: 1,
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples, vae }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/kandinsky5-t2v',
         format: 'mp4',
         codec: 'h264',
      })
   },
})

export default kandinsky5T2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) kandinsky5T2v.vars.prompt.set(process.argv[2])
   if (process.argv[3]) kandinsky5T2v.vars.seed.set(Number(process.argv[3]))
   const execution = await kandinsky5T2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/kandinsky5-t2v`)
   host.disconnect()
}
