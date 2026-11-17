// flux1 t2i krea on Comfy Cloud — FLUX.1 Krea Dev fp8 (UNET + dual CLIP), the photoreal aesthetic fine-tune of Flux.1 Dev: cfg 1, zeroed negative
// source template: flux1_krea_dev.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/flux1-t2i-krea.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const flux1T2iKrea = host.defineWorkflow({
   id: 'flux1-t2i-krea',
   vars: {
      prompt: v.prompt(
         'Highly realistic portrait of a Nordic woman with blonde hair and blue eyes, gaze sharp and intellectual, the cool light of Northern Europe. Minimalist modern outfit, background blurred in cool tones. Solo, centered composition.',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 50 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.UNETLoader({ unet_name: 'flux1-krea-dev_fp8_scaled.safetensors', weight_dtype: 'default' })
      const clip = b.DualCLIPLoader({
         clip_name1: 'clip_l.safetensors',
         clip_name2: 't5xxl_fp16.safetensors',
         type: 'flux',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })

      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      // distilled model ignores cfg: empty negative stays zeroed out, like the template
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: positive })
            : b.CLIPTextEncode({ clip, text: vars.prompt.negative })

      const samples = b.KSampler({
         model,
         positive,
         negative,
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae }) })
   },
})

export default flux1T2iKrea

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) flux1T2iKrea.vars.prompt.set(process.argv[2])
   if (process.argv[3]) flux1T2iKrea.vars.seed.set(Number(process.argv[3]))
   const execution = await flux1T2iKrea.run({ log: true, save: { prefix: 'comfy-ts-zoo/flux1-t2i-krea' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
