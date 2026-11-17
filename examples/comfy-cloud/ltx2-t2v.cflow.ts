// ltx2 t2v on Comfy Cloud — LTX-2 19b dev fp8, text to video WITH a generated soundtrack: a cfg pass, then a distilled-lora refine at x2
// source template: video_ltx2_t2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: video outputs PERSIST on the host (upstream ships no websocket saver for video — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/ltx2-t2v.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const ltx2T2v = host.defineWorkflow({
   id: 'ltx2-t2v',
   vars: {
      // ONE prompt var: describe actions over time, visuals AND sounds; `- ` lines are the NEGATIVE prompt
      prompt: v.prompt(
         'A close-up of a cheerful girl puppet with curly auburn yarn hair and wide button eyes, holding a small red umbrella above her head. Rain falls gently around her. She looks upward and begins to sing with joy in English: "It\'s raining, it\'s raining, I love it when its raining." Her fabric mouth opens and closes to a melodic tune, she sways slightly from side to side in rhythm. The camera holds steady as the rain sparkles against the soft lighting.\n- blurry, low quality, still frame, frames, watermark, overlay, titles, has blurbox, has subtitles',
      ),
      seed: v.seed(42),
      // pass 1 only: the refine pass runs a fixed distilled schedule
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(4, { min: 1, max: 10 }),
      // the OUTPUT size: the first pass samples at half of it, the latent upscaler doubles it
      size: v.size({ width: 1280, height: 720 }),
      // 8n + 1 frames; another count snaps to the closest valid one
      length: v.int(121, { min: 9, max: 481 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'ltx-2-19b-dev-fp8.safetensors' })
      const clip = b.LTXAVTextEncoderLoader({
         text_encoder: 'gemma_3_12B_it_fp4_mixed.safetensors',
         ckpt_name: 'ltx-2-19b-dev-fp8.safetensors',
         device: 'default',
      })
      const audioVae = b.LTXVAudioVAELoader({ ckpt_name: 'ltx-2-19b-dev-fp8.safetensors' })

      const cond = b.LTXVConditioning({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         frame_rate: vars.fps,
      })
      const sampler = b.KSamplerSelect({ sampler_name: 'euler_ancestral' })
      const noise = b.RandomNoise({ noise_seed: vars.seed })

      // pass 1: the dev model with real cfg, video + audio latents sampled together at half resolution
      const avLatent = b.LTXVConcatAVLatent({
         video_latent: b.EmptyLTXVLatentVideo({
            width: Math.round(vars.size.width / 2),
            height: Math.round(vars.size.height / 2),
            length: vars.length,
            batch_size: 1,
         }),
         audio_latent: b.LTXVEmptyLatentAudio({
            frames_number: vars.length,
            frame_rate: vars.fps,
            batch_size: 1,
            audio_vae: audioVae,
         }),
      })
      const base = b.SamplerCustomAdvanced({
         noise,
         guider: b.CFGGuider({
            model: ckpt.outputs.MODEL,
            positive: cond.outputs.positive,
            negative: cond.outputs.negative,
            cfg: vars.cfg,
         }),
         sampler,
         sigmas: b.LTXVScheduler({
            steps: vars.steps,
            max_shift: 2.05,
            base_shift: 0.95,
            stretch: true,
            terminal: 0.1,
            latent: avLatent,
         }),
         latent_image: avLatent,
      })
      const baseAv = b.LTXVSeparateAVLatent({ av_latent: base.outputs.output })
      const cropped = b.LTXVCropGuides({
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         latent: baseAv.outputs.video_latent,
      })

      // pass 2: x2 latent upscale, then a short refine with the distilled lora at cfg 1
      const refined = b.SamplerCustomAdvanced({
         noise,
         guider: b.CFGGuider({
            model: b.LoraLoaderModelOnly({
               model: ckpt.outputs.MODEL,
               lora_name: 'ltx-2-19b-distilled-lora-384.safetensors',
               strength_model: 1,
            }),
            positive: cropped.outputs.positive,
            negative: cropped.outputs.negative,
            cfg: 1,
         }),
         sampler,
         sigmas: b.ManualSigmas({ sigmas: '0.909375, 0.725, 0.421875, 0.0' }),
         latent_image: b.LTXVConcatAVLatent({
            video_latent: b.LTXVLatentUpsampler({
               samples: cropped.outputs.latent,
               upscale_model: b.LatentUpscaleModelLoader({ model_name: 'ltx-2-spatial-upscaler-x2-1.0.safetensors' }),
               vae: ckpt.outputs.VAE,
            }),
            audio_latent: baseAv.outputs.audio_latent,
         }),
      })
      const av = b.LTXVSeparateAVLatent({ av_latent: refined.outputs.denoised_output })

      b.SaveVideo({
         video: b.CreateVideo({
            images: b.VAEDecodeTiled({
               samples: av.outputs.video_latent,
               vae: ckpt.outputs.VAE,
               tile_size: 512,
               overlap: 64,
               temporal_size: 4096,
               temporal_overlap: 8,
            }),
            audio: b.LTXVAudioVAEDecode({ samples: av.outputs.audio_latent, audio_vae: audioVae }),
            fps: vars.fps,
         }),
         filename_prefix: 'comfy-ts-zoo/ltx2-t2v',
         format: 'auto',
         codec: 'auto',
      })
   },
})

export default ltx2T2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ltx2T2v.vars.prompt.set(process.argv[2])
   if (process.argv[3]) ltx2T2v.vars.seed.set(Number(process.argv[3]))
   const execution = await ltx2T2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/ltx2-t2v`)
   host.disconnect()
}
