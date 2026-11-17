// flux2 i2i dev on Comfy Cloud — FLUX.2 Dev fp8mixed (32B, mistral 3 small text encoder), prompt-driven image edit through a reference latent
// source template: image_flux2.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/flux2-i2i-dev.cflow.ts [path/to/image.png] ["edit prompt"] [seed]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const flux2I2iDev = host.defineWorkflow({
   id: 'flux2-i2i-dev',
   vars: {
      image,
      // ONE prompt var, positive only: the guidance is baked into the model, no negative branch
      prompt: v.prompt(
         'The bear is wearing a small pale yellow knitted beanie, with a white fabric patch on the front embroidered with big gray text "FLUX.2 COMFY". Keep everything else unchanged.',
      ),
      seed: v.seed(42),
      // template defaults: 20 steps (its optional 8-step turbo lora branch ships off, dropped here)
      steps: v.int(20, { min: 1, max: 60 }),
      guidance: v.float(4, { min: 1, max: 10 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const model = b.UNETLoader({ unet_name: 'flux2_dev_fp8mixed.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({
         clip_name: 'mistral_3_small_flux2_bf16.safetensors',
         type: 'flux2',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'full_encoder_small_decoder.safetensors' })

      // reference image → ~1MP; its size drives both the latent and the scheduler
      const scaled = b.ImageScaleToTotalPixels({
         image: loaded,
         upscale_method: 'lanczos',
         megapixels: 1,
         resolution_steps: 1,
      })
      const size = b.GetImageSize({ image: scaled })

      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.BasicGuider({
            model,
            conditioning: b.ReferenceLatent({
               conditioning: b.FluxGuidance({
                  conditioning: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
                  guidance: vars.guidance,
               }),
               latent: b.VAEEncode({ pixels: scaled, vae }),
            }),
         }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.Flux2Scheduler({ steps: vars.steps, width: size.outputs.width, height: size.outputs.height }),
         latent_image: b.EmptyFlux2LatentImage({
            width: size.outputs.width,
            height: size.outputs.height,
            batch_size: 1,
         }),
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples: samples.outputs.output, vae }) })
   },
})

export default flux2I2iDev

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) flux2I2iDev.vars.image.set(process.argv[2])
   if (process.argv[3]) flux2I2iDev.vars.prompt.set(process.argv[3])
   if (process.argv[4]) flux2I2iDev.vars.seed.set(Number(process.argv[4]))
   const execution = await flux2I2iDev.run({ log: true, save: { prefix: 'comfy-ts-zoo/flux2-i2i-dev' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
