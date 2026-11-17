// anima t2i base on Comfy Cloud — Anima base v1.0 (anime UNET, qwen3 text encoder), the released base model after the previews
// source template: image_anima_base_v1.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/anima-t2i-base.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const animaT2iBase = host.defineWorkflow({
   id: 'anima-t2i-base',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Anime monochrome cyberpunk front portrait, male figure, sleek skin with delicate mechanical lines, piercing glowing eyes, partially exposed metallic mecha components and light cables, sharp cool style, textured anime brushwork, faint circuit background, high contrast chiaroscuro lighting, ultra fine details, futuristic dystopian mood\n- worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia',
      ),
      seed: v.seed(42),
      // template defaults: 30 steps / cfg 4 (its optional 8-step turbo lora branch ships off, dropped here)
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
         model: b.UNETLoader({ unet_name: 'anima-base-v1.0.safetensors', weight_dtype: 'default' }),
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' }) }),
      })
   },
})

export default animaT2iBase

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) animaT2iBase.vars.prompt.set(process.argv[2])
   if (process.argv[3]) animaT2iBase.vars.seed.set(Number(process.argv[3]))
   const execution = await animaT2iBase.run({ log: true, save: { prefix: 'comfy-ts-zoo/anima-t2i-base' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
