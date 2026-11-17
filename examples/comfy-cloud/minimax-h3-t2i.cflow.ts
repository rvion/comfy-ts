// minimax-h3 t2i on Comfy Cloud — MiniMax H3 int8, the video model rendering one still frame (no cfg, res_multistep)
// source template: image_minimax_h3_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/minimax-h3-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const minimaxH3T2i = host.defineWorkflow({
   id: 'minimax-h3-t2i',
   vars: {
      // ONE prompt var, positive only: the guider takes no negative (`//` lines are comments)
      prompt: v.prompt(
         'Epic sci-fi concept art, extreme low-angle wide shot of a colossal spacecraft hovering above a sandstorm-ravaged desert. The open hangar glows furnace-orange through dense blowing dust and volumetric light shafts. A long boarding ramp descends to the dunes; a lone human climbs it, wind-whipped sand swirling around their ankles, tiny against the massive hull. Low amber sun behind the craft, long god-rays across ochre and rust dunes. Monumental scale, cinematic digital illustration, ultra-detailed metal plating and dust particles, dramatic rim light, sharp focus, no text, no watermark.',
      ),
      seed: v.seed(42),
      // 30 is the checkpoint default; detail keeps improving up to 50
      steps: v.int(30, { min: 1, max: 80 }),
      size: v.size({ width: 1280, height: 720 }),
   },
   build: (b, vars) => {
      // int8 attention on Nvidia and AMD: the template's default backend for this checkpoint
      const model = b.ModelAttentionBackend({
         model: b.UNETLoader({
            unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
            weight_dtype: 'default',
         }),
         attention: 'comfy kitchen attention',
      })
      const clip = b.CLIPLoader({
         clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
         type: 'minimax',
         device: 'default',
      })
      const sampled = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.BasicGuider({ model, conditioning: b.CLIPTextEncode({ clip, text: vars.prompt.positive }) }),
         sampler: b.KSamplerSelect({ sampler_name: 'res_multistep' }),
         sigmas: b.BasicScheduler({ model, scheduler: 'simple', steps: vars.steps, denoise: 1 }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
      })
      // the sampler returns an audio+video latent: keep the video half, decode its single frame
      const av = b.LTXVSeparateAVLatent({ av_latent: sampled.outputs.output })
      b.SaveImageWebsocket({
         images: b.VAEDecode({
            samples: av.outputs.video_latent,
            vae: b.VAELoader({ vae_name: 'minimax_h3_video_vae_fp16.safetensors' }),
         }),
      })
   },
})

export default minimaxH3T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) minimaxH3T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) minimaxH3T2i.vars.seed.set(Number(process.argv[3]))
   const execution = await minimaxH3T2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/minimax-h3-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
