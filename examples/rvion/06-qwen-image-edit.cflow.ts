// qwen image edit 2511 on windows-1 — instruction-driven image editing
// mirrors the official image_qwen_image_edit_2511 template, single reference
// image; the lightning toggle switches the 4-step Lightning lora (cfg 1) vs
// full sampling (cfg 4 — raise steps to ~40 yourself when you flip it off)
// run directly:  bun examples/rvion/06-qwen-image-edit.cflow.ts [path/to/image.png] ["edit instruction"]
import { asAbsolutePath, ComfyTS, exampleImagePath, MediaImage, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const qwenImageEdit = host.defineWorkflow({
   id: 'qwen-image-edit',
   vars: {
      image,
      // `- ` lines are the negative prompt (template default: empty negative encode)
      prompt: v.prompt('turn this photo into a detailed watercolor painting'),
      seed: v.seed(42),
      steps: v.int(4, { min: 1, max: 60 }),
      lightning: v.toggle(true, '4-step lightning lora'),
      prefix: v.text('qwen-image-edit'),
   },
   // async build: the reference image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)
      const scaled = b.FluxKontextImageScale({ image: loaded })

      const unet = b.UNETLoader({ unet_name: 'qwen_image_edit_2511_bf16.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({
         clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         type: 'qwen_image',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })

      let model = b.CFGNorm({
         model: b.ModelSamplingAuraFlow({ model: unet, shift: 3.1 }),
         strength: 1,
         pre_cfg: false,
      })._MODEL
      if (vars.lightning) {
         model = b.LoraLoaderModelOnly({
            model,
            lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
            strength_model: 1,
         })._MODEL
      }

      // both branches carry the reference through the kontext latent method (template shape)
      const positive = b.FluxKontextMultiReferenceLatentMethod({
         reference_latents_method: 'index_timestep_zero',
         conditioning: b.TextEncodeQwenImageEditPlus({ clip, prompt: vars.prompt.positive, vae, image1: scaled }),
      })
      const negative = b.FluxKontextMultiReferenceLatentMethod({
         reference_latents_method: 'index_timestep_zero',
         conditioning: b.TextEncodeQwenImageEditPlus({ clip, prompt: vars.prompt.negative, vae, image1: scaled }),
      })

      const samples = b.KSampler({
         model,
         positive,
         negative,
         latent_image: b.VAEEncode({ pixels: scaled, vae }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.lightning ? 1 : 4,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae }), filename_prefix: vars.prefix })
   },
})

export default qwenImageEdit

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) qwenImageEdit.vars.image.set(process.argv[2])
   if (process.argv[3]) qwenImageEdit.vars.prompt.set(process.argv[3])

   const execution = await qwenImageEdit.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
