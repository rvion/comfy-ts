// boogu i2i on Comfy Cloud — Boogu Image Edit 0.1, instruction-driven image editing (qwen3vl text encoder)
// source template: image_boogu_image_0_1_edit.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/boogu-i2i.cflow.ts [path/to/image.png] ["edit instruction"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const booguI2i = host.defineWorkflow({
   id: 'boogu-i2i',
   vars: {
      image,
      prompt: v.prompt('remove the hat'),
      seed: v.seed(42),
      // template defaults: 25 steps / cfg 3.5, dpmpp_2m + simple sigmas
      steps: v.int(25, { min: 1, max: 60 }),
      cfg: v.float(3.5, { min: 0, max: 30 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)
      // the encode reads the FULL input image; the ~1MP resize only sizes the empty latent
      const size = b.GetImageSize({
         image: b.ImageScaleToTotalPixels({ image: loaded, upscale_method: 'lanczos', megapixels: 1 }),
      })
      const unet = b.UNETLoader({ unet_name: 'boogu_image_edit_fp8_scaled.safetensors', weight_dtype: 'default' })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })
      // ONE encode node carries both branches: prompt + negative_prompt in, positive + negative out
      const encode = b.TextEncodeBooguEdit({
         clip: b.CLIPLoader({ clip_name: 'qwen3vl_8b_fp8_scaled.safetensors', type: 'boogu', device: 'default' }),
         prompt: vars.prompt.positive,
         negative_prompt: vars.prompt.negative,
         vae,
         'images.image_1': loaded.outputs.IMAGE,
      })
      // template wiring kept verbatim: the AuraFlow shift (3.16) applies to the
      // sigmas only — BasicScheduler reads the shifted model, SamplerCustom the raw UNET
      const sampled = b.SamplerCustom({
         model: unet,
         positive: encode.outputs.positive,
         negative: encode.outputs.negative,
         sampler: b.KSamplerSelect({ sampler_name: 'dpmpp_2m' }),
         sigmas: b.BasicScheduler({
            model: b.ModelSamplingAuraFlow({ model: unet, shift: 3.16 }),
            scheduler: 'simple',
            steps: vars.steps,
            denoise: 1,
         }),
         latent_image: b.EmptyLatentImage({ width: size.outputs.width, height: size.outputs.height, batch_size: 1 }),
         add_noise: true,
         noise_seed: vars.seed,
         cfg: vars.cfg,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples: sampled.outputs.output, vae }) })
   },
})

export default booguI2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) booguI2i.vars.image.set(process.argv[2])
   if (process.argv[3]) booguI2i.vars.prompt.set(process.argv[3])
   const execution = await booguI2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/boogu-i2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
