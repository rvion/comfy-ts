// firered i2i on Comfy Cloud — FireRed Image Edit 1.1, instruction-driven image editing (qwen-image-edit lineage)
// source template: image_firered_image_edit1_1.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/firered-i2i.cflow.ts [path/to/image.png] ["edit instruction"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const fireredI2i = host.defineWorkflow({
   id: 'firered-i2i',
   vars: {
      image,
      prompt: v.prompt(
         'restyle the outfit into sheer frosted white fabric with glowing fiber-optic threads, photorealistic',
      ),
      seed: v.seed(43),
      // template defaults: 40 steps / cfg 4 (its optional 8-step Lightning lora branch ships off, dropped here)
      steps: v.int(40, { min: 1, max: 60 }),
      cfg: v.float(4, { min: 0, max: 30 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const scaled = b.ImageScaleToTotalPixels({
         image: await img.loadInWorkflow_viaLoadImageNode(wf),
         upscale_method: 'lanczos',
         megapixels: 1,
      })
      const clip = b.CLIPLoader({ clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image' })
      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })
      // edit conditioning reads the input image itself: both branches reference it
      const encode = (text: string) => b.TextEncodeQwenImageEditPlus({ prompt: text, clip, vae, image1: scaled })
      const model = b.CFGNorm({
         model: b.ModelSamplingAuraFlow({
            model: b.UNETLoader({
               unet_name: 'FireRed-Image-Edit-1.1-transformer.safetensors',
               weight_dtype: 'default',
            }),
            shift: 3.1,
         }),
         strength: 1,
         pre_cfg: false,
      })
      const samples = b.KSampler({
         model,
         positive: encode(vars.prompt.positive),
         negative: encode(vars.prompt.negative),
         latent_image: b.VAEEncode({ pixels: scaled, vae }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae }) })
   },
})

export default fireredI2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) fireredI2i.vars.image.set(process.argv[2])
   if (process.argv[3]) fireredI2i.vars.prompt.set(process.argv[3])
   const execution = await fireredI2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/firered-i2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
