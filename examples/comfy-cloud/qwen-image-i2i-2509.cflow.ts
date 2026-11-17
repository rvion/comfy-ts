// qwen-image i2i 2509 on Comfy Cloud — Qwen-Image-Edit 2509 fp8 + its 4-step Lightning lora, instruction-driven image editing at cfg 1
// source template: image_qwen_image_edit_2509.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/qwen-image-i2i-2509.cflow.ts [path/to/image.png] ["edit instruction"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const qwenImageI2i2509 = host.defineWorkflow({
   id: 'qwen-image-i2i-2509',
   vars: {
      image,
      prompt: v.prompt('Replace the bear with a dalmatian, keeping the environment and scene consistent'),
      seed: v.seed(42),
      // the template ships its Lightning lora ON: 4 steps at cfg 1
      steps: v.int(4, { min: 1, max: 30 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const scaled = b.FluxKontextImageScale({ image: await img.loadInWorkflow_viaLoadImageNode(wf) })
      const clip = b.CLIPLoader({
         clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         type: 'qwen_image',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })
      // edit conditioning reads the input image itself, on both branches
      const encode = (text: string) => b.TextEncodeQwenImageEditPlus({ prompt: text, clip, vae, image1: scaled })
      const model = b.CFGNorm({
         model: b.ModelSamplingAuraFlow({
            model: b.LoraLoaderModelOnly({
               model: b.UNETLoader({
                  unet_name: 'qwen_image_edit_2509_fp8_e4m3fn.safetensors',
                  weight_dtype: 'default',
               }),
               lora_name: 'Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors',
               strength_model: 1,
            }),
            shift: 3,
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
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae }) })
   },
})

export default qwenImageI2i2509

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) qwenImageI2i2509.vars.image.set(process.argv[2])
   if (process.argv[3]) qwenImageI2i2509.vars.prompt.set(process.argv[3])
   const execution = await qwenImageI2i2509.run({ log: true, save: { prefix: 'comfy-ts-zoo/qwen-image-i2i-2509' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
