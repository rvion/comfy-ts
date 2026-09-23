// qwen image 2.1 text-to-image on windows-1 — mirrors the official image_qwen_image_2_1_t2i template
// int8 diffusion model + qwen3-vl 8b text encoder, 25 steps at cfg 1 (the negative only bites once cfg > 1)
// box inventory: qwen_image_2.1_int8_convrot, qwen3vl_8b_int8_convrot, qwen_image_2.1_vae_bf16 (Comfy-Org/Qwen-Image-2.1), ComfyUI ≥ 0.37
// run directly:  bun examples/rvion/08-qwen-image-21-t2i.cflow.ts ["prompt"] [seed]
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

export const qwenImage21T2i = host.defineWorkflow({
   id: 'qwen-image-21-t2i',
   vars: {
      // `- ` lines are the negative prompt, `//` lines are comments
      prompt: v.prompt(
         'Greyscale fashion editorial portrait of an avant-garde woman tilted upwards in profile, striking high-contrast chiaroscuro lighting, oversized thick-rimmed circular black sunglasses, a high-necked structural dress in a disrupted optical camouflage pattern of oversized polka dots and pixelated stippling. The background is a vivid mixed-media graphic collage: flat lime green planes, black and white overlapping circles, bold zebra-striped semi-circles, micro-halftone dot matrices. Sharp silhouettes, paper cut-out edges, clean graphic novel textures. No text, no letters, no logos, no watermark.',
      ),
      seed: v.seed(42, { mode: '+' }),
      steps: v.int(25, { min: 1, max: 60 }),
      cfg: v.float(1, { min: 1, max: 10 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const unet = b.UNETLoader({ unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({
         clip_name: 'qwen3vl_8b_int8_convrot.safetensors',
         type: 'qwen_image',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'qwen_image_2.1_vae_bf16.safetensors' })

      const cond = b.TextEncodeQwenImage21({
         clip,
         prompt: vars.prompt.positive,
         negative_prompt: vars.prompt.negative,
         resolution: 1024,
      })
      const samples = b.KSampler({
         model: unet,
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
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

export default qwenImage21T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) qwenImage21T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) qwenImage21T2i.vars.seed.set(Number(process.argv[3]))

   const execution = await qwenImage21T2i.run({ log: true, save: { prefix: 'comfy-ts-example/qwen-image-21-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
