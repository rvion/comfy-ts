// capybara i2i on Comfy Cloud — Capybara v0.1 image edit: the input steers a single-frame i2v pass
// source template: Image_capybara_v0_1_image_edit.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/capybara-i2i.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const capybaraI2i = host.defineWorkflow({
   id: 'capybara-i2i',
   vars: {
      image,
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Keep the characters and fluttering costumes unchanged, replace the indoor scene with an outdoor grassland setting\n- blurry, low quality, distorted, ugly, watermark, text',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(6, { min: 0, max: 30 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

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
      // the edit is a length-1 image-to-video pass: input feeds the packaged
      // conditioning+latent and a clip vision pass (1024 = template's resize target)
      const video = b.HunyuanVideo15ImageToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae,
         start_image: loaded,
         clip_vision_output: b.CLIPVisionEncode({
            clip_vision: b.CLIPVisionLoader({ clip_name: 'sigclip_vision_patch14_384.safetensors' }),
            image: loaded,
            crop: 'none',
         }),
         width: 1024,
         height: 1024,
         length: 1,
         batch_size: 1,
      })
      // template's SamplerCustomAdvanced pipeline collapsed to KSampler (euler/simple/cfg survive)
      const samples = b.KSampler({
         model,
         positive: video.outputs.positive,
         negative: video.outputs.negative,
         latent_image: video.outputs.latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae }), filename_prefix: 'comfy-ts-zoo/capybara-i2i' })
   },
})

export default capybaraI2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) capybaraI2i.vars.image.set(process.argv[2])
   if (process.argv[3]) capybaraI2i.vars.prompt.set(process.argv[3])
   const execution = await capybaraI2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
