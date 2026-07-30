// flux2 t2i on Comfy Cloud — FLUX.2 Klein base 4B, CFG-guided text to image
// source template: image_flux2_klein_text_to_image.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/flux2-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const flux2T2i = host.defineWorkflow({
   id: 'flux2-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A hedgehog wearing a tiny party hat surrounded by confetti, early digital camera style, slight noise, flash photography, candid moment, 2000s digicam aesthetic, festive birthday celebration atmosphere',
      ),
      seed: v.seed(0),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(5, { min: 0, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.UNETLoader({ unet_name: 'flux-2-klein-base-4b.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({ clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'flux2-vae.safetensors' })

      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.CFGGuider({
            model,
            positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
            negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
            cfg: vars.cfg,
         }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.Flux2Scheduler({ steps: vars.steps, width: vars.size.width, height: vars.size.height }),
         latent_image: b.EmptyFlux2LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
      })
      b.SaveImage({
         images: b.VAEDecode({ samples: samples.outputs.output, vae }),
         filename_prefix: 'comfy-ts-zoo/flux2-t2i',
      })
   },
})

export default flux2T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) flux2T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) flux2T2i.vars.seed.set(Number(process.argv[3]))

   const execution = await flux2T2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
