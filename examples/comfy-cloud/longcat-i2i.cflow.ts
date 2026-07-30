// longcat i2i on Comfy Cloud — LongCat-Image-Edit (Meituan), instruction-driven image editing
// source template: image_longcat_image_edit.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/longcat-i2i.cflow.ts [path/to/image.png] ["edit instruction"]
import { mkdirSync } from 'node:fs'
import { asAbsolutePath, ComfyTS, MediaImage, v } from 'comfy-ts'
import { dirname, resolve } from 'pathe'
import sharp from 'sharp'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

/** empty path → a generated flat-color placeholder (keeps the example self-contained) */
async function resolveInputImage(path: string): Promise<string> {
   if (path.trim() !== '') return resolve(path)
   const placeholder = ComfyTS.create().resolveFromOutput('example-input.png')
   mkdirSync(dirname(placeholder), { recursive: true })
   await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 80, g: 120, b: 180 } } })
      .png()
      .toFile(placeholder)
   return placeholder
}

export const longcatI2i = host.defineWorkflow({
   id: 'longcat-i2i',
   vars: {
      image: v.text('', 'image path'),
      prompt: v.prompt('relight the scene with the warm light of a rising sun, early morning atmosphere'),
      seed: v.seed(42),
      // template defaults: 50 steps, cfg 4.5, guidance 4.5
      steps: v.int(50, { min: 1, max: 60 }),
      cfg: v.float(4.5, { min: 0, max: 30 }),
      guidance: v.float(4.5, { min: 0, max: 20 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(await resolveInputImage(vars.image)) })
      const image = b.ImageScaleToTotalPixels({
         image: await img.loadInWorkflow_viaLoadImageNode(wf),
         upscale_method: 'lanczos',
         megapixels: 1,
         resolution_steps: 16,
      })
      const clip = b.CLIPLoader({
         clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         type: 'longcat_image',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })
      // edit conditioning reads the input image itself: both branches reference it
      const encode = (text: string) =>
         b.FluxKontextMultiReferenceLatentMethod({
            reference_latents_method: 'index',
            conditioning: b.FluxGuidance({
               conditioning: b.TextEncodeQwenImageEdit({ prompt: text, clip, vae, image }),
               guidance: vars.guidance,
            }),
         })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'longcat_image_edit_bf16.safetensors', weight_dtype: 'default' }),
         positive: encode(vars.prompt.positive),
         negative: encode(vars.prompt.negative),
         latent_image: b.VAEEncode({ pixels: image, vae }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae }), filename_prefix: 'comfy-ts-zoo/longcat-i2i' })
   },
})

export default longcatI2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) longcatI2i.vars.image.set(process.argv[2])
   if (process.argv[3]) longcatI2i.vars.prompt.set(process.argv[3])
   const execution = await longcatI2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
