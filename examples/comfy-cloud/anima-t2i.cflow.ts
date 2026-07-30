// anima t2i on Comfy Cloud — Anima preview 3 (anime UNET, qwen3 text encoder), text to image
// source template: image_anima_preview.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/anima-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const animaT2i = host.defineWorkflow({
   id: 'anima-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'masterpiece, best quality, score_7, safe, anime, close-up of a futuristic cyberpunk robotic eye, a glowing Earth reflected in the pupil, neon accent lighting, sharp line art\n- worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia',
      ),
      seed: v.seed(42),
      steps: v.int(30, { min: 1, max: 60 }),
      cfg: v.float(4, { min: 0, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({
         clip_name: 'qwen_3_06b_base.safetensors',
         type: 'stable_diffusion',
         device: 'default',
      })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'anima-preview3-base.safetensors', weight_dtype: 'default' }),
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'er_sde',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' }) }),
         filename_prefix: 'comfy-ts-zoo/anima-t2i',
      })
   },
})

export default animaT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) animaT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) animaT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await animaT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
