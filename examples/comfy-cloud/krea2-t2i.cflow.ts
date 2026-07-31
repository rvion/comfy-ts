// krea2 t2i on Comfy Cloud — Krea 2 Turbo fp8, 8-step distilled text to image (cfg 1), cloud twin of example 04
// source template: image_krea2_turbo_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/krea2-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const krea2T2i = host.defineWorkflow({
   id: 'krea2-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A surreal digital illustration of a hand holding a martini glass, overlaid with whimsical ink-style doodles: a cartoon figure inside the glass, a drawn citrus wedge on the rim, abstract sketches on a clean white background.',
      ),
      seed: v.seed(42),
      steps: v.int(8, { min: 1, max: 40 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.UNETLoader({ unet_name: 'krea2_turbo_fp8_scaled.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({ clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default' })
      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      // turbo distill: no negative lines → zeroed-out conditioning (the template's own default)
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: positive })
            : b.CLIPTextEncode({ clip, text: vars.prompt.negative })
      const samples = b.KSampler({
         model,
         positive,
         negative,
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' }) }),
      })
   },
})

export default krea2T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) krea2T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) krea2T2i.vars.seed.set(Number(process.argv[3]))
   const execution = await krea2T2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/krea2-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
