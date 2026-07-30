// hunyuan-video t2v on Comfy Cloud — HunyuanVideo 1.5 720p text to video, 5s @ 24fps
// source template: video_hunyuan_video_1.5_720p_t2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/hunyuan-video-t2v.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const hunyuanVideoT2v = host.defineWorkflow({
   id: 'hunyuan-video-t2v',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         "A paper airplane released from the top of a skyscraper, gliding through urban canyons, crossing traffic, flying over streets, spiraling upward between buildings. The camera follows the paper airplane's perspective, shooting cityscape in first-person POV, finally flying toward the sunset, disappearing in golden light. Creative camera movement, free perspective, dreamlike colors.",
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(6, { min: 0, max: 30 }),
      size: v.size({ width: 1280, height: 720 }),
      length: v.int(121, { min: 1, max: 241 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'hunyuanvideo1.5_720p_t2v_fp16.safetensors', weight_dtype: 'default' }),
         shift: 7,
      })
      const clip = b.DualCLIPLoader({
         clip_name1: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         clip_name2: 'byt5_small_glyphxl_fp16.safetensors',
         type: 'hunyuan_video_15',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'hunyuanvideo15_vae_fp16.safetensors' })
      // template's SamplerCustomAdvanced pipeline collapsed to KSampler (euler/simple/cfg survive)
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptyHunyuanVideo15Latent({
            width: vars.size.width,
            height: vars.size.height,
            length: vars.length,
            batch_size: 1,
         }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples, vae }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/hunyuan-video-t2v',
         format: 'mp4',
         codec: 'h264',
      })
   },
})

export default hunyuanVideoT2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) hunyuanVideoT2v.vars.prompt.set(process.argv[2])
   if (process.argv[3]) hunyuanVideoT2v.vars.seed.set(Number(process.argv[3]))
   const execution = await hunyuanVideoT2v.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
