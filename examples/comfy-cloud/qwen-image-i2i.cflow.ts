// qwen-image i2i on Comfy Cloud — Qwen-Image-Edit 2511, instruction-driven image editing
// source template: image_qwen_image_edit_2511.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/qwen-image-i2i.cflow.ts [path/to/image.png] ["edit instruction"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const qwenImageI2i = host.defineWorkflow({
   id: 'qwen-image-i2i',
   vars: {
      image,
      prompt: v.prompt('turn this into a watercolor painting'),
      seed: v.seed(42),
      // template defaults: 40 steps / cfg 4 (its optional 4-step Lightning lora branch ships off, dropped here)
      steps: v.int(40, { min: 1, max: 60 }),
      cfg: v.float(4, { min: 0, max: 30 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const scaled = b.FluxKontextImageScale({ image: await img.loadInWorkflow_viaLoadImageNode(wf) })
      const clip = b.CLIPLoader({ clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image' })
      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })
      // edit conditioning reads the input image itself: both branches reference it at timestep zero
      const encode = (text: string) =>
         b.FluxKontextMultiReferenceLatentMethod({
            reference_latents_method: 'index_timestep_zero',
            conditioning: b.TextEncodeQwenImageEditPlus({ prompt: text, clip, vae, image1: scaled }),
         })
      const model = b.CFGNorm({
         model: b.ModelSamplingAuraFlow({
            model: b.UNETLoader({ unet_name: 'qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype: 'default' }),
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
      b.SaveImage({ images: b.VAEDecode({ samples, vae }), filename_prefix: 'comfy-ts-zoo/qwen-image-i2i' })
   },
})

export default qwenImageI2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) qwenImageI2i.vars.image.set(process.argv[2])
   if (process.argv[3]) qwenImageI2i.vars.prompt.set(process.argv[3])
   const execution = await qwenImageI2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
