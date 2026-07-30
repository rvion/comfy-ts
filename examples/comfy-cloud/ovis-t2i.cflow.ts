// ovis t2i on Comfy Cloud — Ovis 2.5 image (AuraFlow-style UNET, shift 3), text to image
// source template: image_ovis_text_to_image.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/ovis-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const ovisT2i = host.defineWorkflow({
   id: 'ovis-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Child lying on bed with balloons, streamers, and plush toys, surreal dreamlike scene. Close-up, centered on the child and surrounding objects. Soft, diffused lighting.',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(5, { min: 0, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({ clip_name: 'ovis_2.5.safetensors', type: 'ovis', device: 'default' })
      const samples = b.KSampler({
         model: b.ModelSamplingAuraFlow({
            model: b.UNETLoader({ unet_name: 'ovis_image_bf16.safetensors', weight_dtype: 'default' }),
            shift: 3,
         }),
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'ae.safetensors' }) }),
         filename_prefix: 'comfy-ts-zoo/ovis-t2i',
      })
   },
})

export default ovisT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ovisT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) ovisT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await ovisT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
