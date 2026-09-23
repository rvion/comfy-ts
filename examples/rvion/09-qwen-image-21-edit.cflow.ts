// qwen image 2.1 edit on windows-1 — mirrors the official image_qwen_image_2_1_image_edit template, single reference image
// the reference is seen by the text encoder AND spliced in as a vae latent; the output keeps the reference's own size
// the "remove background" preset is the official image_qwen_image_2_1_background_removal template: same graph, that instruction
// box inventory: qwen_image_2.1_int8_convrot, qwen3vl_8b_int8_convrot, qwen_image_2.1_vae_bf16 (Comfy-Org/Qwen-Image-2.1), ComfyUI ≥ 0.37
// run directly:  bun examples/rvion/09-qwen-image-21-edit.cflow.ts [path/to/image.png] ["edit instruction"]
import { asAbsolutePath, ComfyTS, exampleImagePath, MediaImage, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const qwenImage21Edit = host.defineWorkflow({
   id: 'qwen-image-21-edit',
   vars: {
      image,
      // the reference is <image1> in the instruction. `- ` lines are the negative prompt
      prompt: v.prompt(
         'Keep the bear and its pose in <image1> unchanged, wrap a hand-knitted red wool scarf around its neck, realistic wool texture, natural folds, keep the original background and lighting, sharp details',
         {
            presets: {
               'knitted scarf':
                  'Keep the bear and its pose in <image1> unchanged, wrap a hand-knitted red wool scarf around its neck, realistic wool texture, natural folds, keep the original background and lighting, sharp details',
               'remove background': 'Remove the background, and output a PNG image',
               watercolor: 'Turn <image1> into a detailed watercolor painting, keep the composition unchanged',
            },
         },
      ),
      seed: v.seed(42, { mode: '+' }),
      steps: v.int(25, { min: 1, max: 60 }),
   },
   // async build: the reference image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const unet = b.UNETLoader({ unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({
         clip_name: 'qwen3vl_8b_int8_convrot.safetensors',
         type: 'qwen_image',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'qwen_image_2.1_vae_bf16.safetensors' })

      // resolution 0: the reference keeps its own size (rounded to a multiple of 32)
      const cond = b.TextEncodeQwenImage21({
         clip,
         prompt: vars.prompt.positive,
         negative_prompt: vars.prompt.negative,
         resolution: 0,
         'images.image_1': loaded,
         vae,
      })
      const samples = b.KSampler({
         // kv cache of the reference prefix, reused across steps instead of recomputed
         model: b.QwenImage21Cache({ model: unet, device: 'auto', dtype: 'default' }),
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         latent_image: cond.outputs.latent,
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

export default qwenImage21Edit

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) qwenImage21Edit.vars.image.set(process.argv[2])
   if (process.argv[3]) qwenImage21Edit.vars.prompt.set(process.argv[3])

   const execution = await qwenImage21Edit.run({ log: true, save: { prefix: 'comfy-ts-example/qwen-image-21-edit' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
