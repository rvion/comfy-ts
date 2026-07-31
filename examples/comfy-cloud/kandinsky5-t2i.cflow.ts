// kandinsky5 t2i on Comfy Cloud — Kandinsky 5.0 Lite text to image (Qwen2.5-VL + clip_l dual encoder, flux ae VAE)
// source template: image_kandinsky5_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/kandinsky5-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const kandinsky5T2i = host.defineWorkflow({
   id: 'kandinsky5-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'a joyful hiker in a mustard-yellow knit beanie and chunky sweater, jagged Dolomites peaks behind, warm golden-amber vintage filter, subtle film grain, crisp saturated blue sky',
      ),
      seed: v.seed(42),
      steps: v.int(50, { min: 1, max: 60 }),
      cfg: v.float(3.5, { min: 0, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'kandinsky5lite_t2i.safetensors', weight_dtype: 'default' }),
         shift: 3,
      })
      const clip = b.DualCLIPLoader({
         clip_name1: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         clip_name2: 'clip_l.safetensors',
         type: 'kandinsky5_image',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
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

export default kandinsky5T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) kandinsky5T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) kandinsky5T2i.vars.seed.set(Number(process.argv[3]))
   const execution = await kandinsky5T2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/kandinsky5-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
