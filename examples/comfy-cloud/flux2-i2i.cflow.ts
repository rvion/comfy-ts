// flux2 i2i on Comfy Cloud — FLUX.2 Klein 4B distilled image edit (prompt-driven, 4 steps, cfg 1)
// source template: image_flux2_klein_image_edit_4b_distilled.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/flux2-i2i.cflow.ts [path/to/image.png] ["edit prompt"] [seed]
import { mkdirSync } from 'node:fs'
import { asAbsolutePath, ComfyTS, MediaImage, v } from 'comfy-ts'
import { dirname, resolve } from 'pathe'
import sharp from 'sharp'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

/** empty path → a generated flat-color placeholder (keeps the example self-contained, like example 02) */
async function resolveInputImage(path: string): Promise<string> {
   if (path.trim() !== '') return resolve(path)
   const placeholder = ComfyTS.create().resolveFromOutput('example-input.png')
   mkdirSync(dirname(placeholder), { recursive: true })
   await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 210, g: 140, b: 80 } } })
      .png()
      .toFile(placeholder)
   return placeholder
}

export const flux2I2i = host.defineWorkflow({
   id: 'flux2-i2i',
   vars: {
      image: v.text('', 'image path'),
      prompt: v.prompt('Change the color to blue.'),
      seed: v.seed(7),
      steps: v.int(4, { min: 1, max: 60 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(await resolveInputImage(vars.image)) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const model = b.UNETLoader({ unet_name: 'flux-2-klein-4b-fp8.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({ clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'flux2-vae.safetensors' })

      // reference image → ~1MP; its size drives both the latent and the scheduler
      const scaled = b.ImageScaleToTotalPixels({
         image: loaded,
         upscale_method: 'nearest-exact',
         megapixels: 1,
         resolution_steps: 1,
      })
      const size = b.GetImageSize({ image: scaled })
      const reference = b.VAEEncode({ pixels: scaled, vae })

      // distilled: prompt only, the negative branch is the zeroed-out positive
      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.CFGGuider({
            model,
            positive: b.ReferenceLatent({ conditioning: positive, latent: reference }),
            negative: b.ReferenceLatent({
               conditioning: b.ConditioningZeroOut({ conditioning: positive }),
               latent: reference,
            }),
            cfg: 1,
         }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.Flux2Scheduler({ steps: vars.steps, width: size.outputs.width, height: size.outputs.height }),
         latent_image: b.EmptyFlux2LatentImage({
            width: size.outputs.width,
            height: size.outputs.height,
            batch_size: 1,
         }),
      })
      b.SaveImage({
         images: b.VAEDecode({ samples: samples.outputs.output, vae }),
         filename_prefix: 'comfy-ts-zoo/flux2-i2i',
      })
   },
})

export default flux2I2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) flux2I2i.vars.image.set(process.argv[2])
   if (process.argv[3]) flux2I2i.vars.prompt.set(process.argv[3])
   if (process.argv[4]) flux2I2i.vars.seed.set(Number(process.argv[4]))

   const execution = await flux2I2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
