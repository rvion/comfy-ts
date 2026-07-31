// ernie t2i on Comfy Cloud — ERNIE Image Turbo (Baidu), 8-step distilled text to image (cfg 1, flux2 vae)
// source template: image_ernie_image_turbo.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/ernie-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const ernieT2i = host.defineWorkflow({
   id: 'ernie-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'side-profile portrait of a young woman with sleek dark hair in a low bun, white ruffled-collar shirt, deep indigo twilight sky, neon pink-orange rim light tracing her profile, cinematic color blocking',
      ),
      seed: v.seed(42),
      steps: v.int(8, { min: 1, max: 40 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.UNETLoader({ unet_name: 'ernie-image-turbo.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({ clip_name: 'ministral-3-3b.safetensors', type: 'flux2', device: 'default' })
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
         latent_image: b.EmptyFlux2LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'flux2-vae.safetensors' }) }),
      })
   },
})

export default ernieT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ernieT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) ernieT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await ernieT2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/ernie-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
