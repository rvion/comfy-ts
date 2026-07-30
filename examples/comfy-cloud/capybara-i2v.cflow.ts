// capybara i2v on Comfy Cloud — Capybara v0.1 image to video (HunyuanVideo 1.5 arch), ~3s @ 24fps
// source template: video_capybara_v0_1_image_to_video.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/capybara-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('lioness_768x768.jpg'))

export const capybaraI2v = host.defineWorkflow({
   id: 'capybara-i2v',
   vars: {
      image,
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A vibrant, sunny video scene: a young man and woman sitting on a green bench on a tennis court, taking a selfie with a white smartphone. The camera starts at a low angle and slowly tilts upward, revealing the clear blue sky. The woman raises one arm playfully, and they hold hands, radiating youthful energy. Bright, cinematic, smooth slow camera movement, warm vivid color grading.\n- blurry, low quality, distorted, ugly, watermark, text',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(6, { min: 0, max: 30 }),
      length: v.int(81, { min: 1, max: 241 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   // async build: the start image is uploaded (hash-named, deduped) per run
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
      // the start image feeds both the packaged conditioning+latent and a clip vision pass
      const video = b.HunyuanVideo15ImageToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae,
         start_image: loaded,
         clip_vision_output: b.CLIPVisionEncode({
            clip_vision: b.CLIPVisionLoader({ clip_name: 'sigclip_vision_patch14_384.safetensors' }),
            image: loaded,
            crop: 'center',
         }),
         width: 640,
         height: 640,
         length: vars.length,
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
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples, vae }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/capybara-i2v',
      })
   },
})

export default capybaraI2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) capybaraI2v.vars.image.set(process.argv[2])
   if (process.argv[3]) capybaraI2v.vars.prompt.set(process.argv[3])
   const execution = await capybaraI2v.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
