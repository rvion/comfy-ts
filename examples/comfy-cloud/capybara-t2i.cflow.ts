// capybara t2i on Comfy Cloud — Capybara v0.1 text to image (HunyuanVideo 1.5 arch, single-frame latent)
// source template: Image_capybara_v0_1_text_to_image.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/capybara-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const capybaraT2i = host.defineWorkflow({
   id: 'capybara-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A serene portrait of a young woman, her profile framed against a soft, desaturated teal backdrop; the black habit and white coif and collar are rendered in muted, low-saturation tones, with gentle lighting casting subtle shadows on her face, creating a calm, understated visual balance.\n- blurry, low quality, distorted, ugly, watermark, text',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(6, { min: 0, max: 30 }),
      size: v.size({ width: 1280, height: 1280 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'capybara_v0.1.safetensors', weight_dtype: 'default' }),
         shift: 7,
      })
      const clip = b.DualCLIPLoader({
         clip_name1: 'qwen_2.5_vl_7b.safetensors',
         clip_name2: 'byt5_small_glyphxl_fp16.safetensors',
         type: 'hunyuan_video_15',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'hunyuanvideo15_vae_fp16.safetensors' })
      // template's SamplerCustomAdvanced pipeline collapsed to KSampler (euler/simple/cfg survive);
      // an image is a length-1 video latent on this arch
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptyHunyuanVideo15Latent({
            width: vars.size.width,
            height: vars.size.height,
            length: 1,
            batch_size: 1,
         }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae }), filename_prefix: 'comfy-ts-zoo/capybara-t2i' })
   },
})

export default capybaraT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) capybaraT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) capybaraT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await capybaraT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
