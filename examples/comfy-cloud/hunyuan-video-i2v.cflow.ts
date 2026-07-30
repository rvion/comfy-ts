// hunyuan-video i2v on Comfy Cloud — HunyuanVideo 1.5 720p image to video, 5s @ 24fps from a start image
// source template: video_hunyuan_video_1.5_720p_i2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/hunyuan-video-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { mkdirSync } from 'node:fs'
import { asAbsolutePath, ComfyTS, MediaImage, v } from 'comfy-ts'
import { dirname, resolve } from 'pathe'
import sharp from 'sharp'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

/** empty path → a generated flat-color placeholder (keeps the example self-contained) */
async function resolveInputImage(path: string): Promise<string> {
   if (path.trim() !== '') return resolve(path)
   const placeholder = ComfyTS.create().resolveFromOutput('hunyuan-video-i2v-input.png')
   mkdirSync(dirname(placeholder), { recursive: true })
   await sharp({ create: { width: 1280, height: 720, channels: 3, background: { r: 40, g: 60, b: 140 } } })
      .png()
      .toFile(placeholder)
   return placeholder
}

export const hunyuanVideoI2v = host.defineWorkflow({
   id: 'hunyuan-video-i2v',
   vars: {
      image: v.text('', 'image path'),
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A feathered young dinosaur with ruffled brown and white plumage moves alertly through a sun-dappled coniferous forest, sunbeams filtering through the tall canopy over mossy undergrowth and ferns, soft glowing mist, dappled light dancing across its textured feathers, lush ancient wilderness, lifelike detail',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(6, { min: 0, max: 30 }),
      length: v.int(121, { min: 1, max: 241 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(await resolveInputImage(vars.image)) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'hunyuanvideo1.5_720p_i2v_fp16.safetensors', weight_dtype: 'default' }),
         shift: 7,
      })
      const clip = b.DualCLIPLoader({
         clip_name1: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
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
         width: 1280,
         height: 720,
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
         filename_prefix: 'comfy-ts-zoo/hunyuan-video-i2v',
         format: 'mp4',
         codec: 'h264',
      })
   },
})

export default hunyuanVideoI2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) hunyuanVideoI2v.vars.image.set(process.argv[2])
   if (process.argv[3]) hunyuanVideoI2v.vars.prompt.set(process.argv[3])
   const execution = await hunyuanVideoI2v.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
