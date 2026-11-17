// flux2 t2i dev on Comfy Cloud — FLUX.2 Dev fp8mixed (32B, mistral 3 small text encoder), guidance-distilled text to image
// source template: image_flux2_text_to_image.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/flux2-t2i-dev.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const flux2T2iDev = host.defineWorkflow({
   id: 'flux2-t2i-dev',
   vars: {
      // ONE prompt var, positive only: the guidance is baked into the model, no negative branch
      prompt: v.prompt(
         'high fashion, vintage couture, street photography, luxury fashion shoot, neo brutalist architecture, pastel paints',
      ),
      seed: v.seed(42),
      // template defaults: 20 steps (its optional 8-step turbo lora branch ships off, dropped here)
      steps: v.int(20, { min: 1, max: 60 }),
      guidance: v.float(4, { min: 1, max: 10 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.UNETLoader({ unet_name: 'flux2_dev_fp8mixed.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({
         clip_name: 'mistral_3_small_flux2_bf16.safetensors',
         type: 'flux2',
         device: 'default',
      })
      // full encoder, small decoder: the lighter flux2 vae the template picks
      const vae = b.VAELoader({ vae_name: 'full_encoder_small_decoder.safetensors' })

      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.BasicGuider({
            model,
            conditioning: b.FluxGuidance({
               conditioning: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
               guidance: vars.guidance,
            }),
         }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.Flux2Scheduler({ steps: vars.steps, width: vars.size.width, height: vars.size.height }),
         latent_image: b.EmptyFlux2LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples: samples.outputs.output, vae }) })
   },
})

export default flux2T2iDev

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) flux2T2iDev.vars.prompt.set(process.argv[2])
   if (process.argv[3]) flux2T2iDev.vars.seed.set(Number(process.argv[3]))
   const execution = await flux2T2iDev.run({ log: true, save: { prefix: 'comfy-ts-zoo/flux2-t2i-dev' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
