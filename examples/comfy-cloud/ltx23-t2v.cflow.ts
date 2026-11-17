// ltx23 t2v on Comfy Cloud — LTX-2.3 22b dev fp8 + its distilled lora, text to video WITH a generated soundtrack, two passes at cfg 1
// source template: video_ltx2_3_t2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: video outputs PERSIST on the host (upstream ships no websocket saver for video — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/ltx23-t2v.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

const CKPT = 'ltx-2.3-22b-dev-fp8.safetensors'

export const ltx23T2v = host.defineWorkflow({
   id: 'ltx23-t2v',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Dynamic cinematic close-up of high-tech modular machinery self-assembling in midair, precision robotic parts, magnetic connectors, and glowing circuits clicking together, subtle smoke and light flares, extremely detailed titanium textures. The final product displays a clean, clear surface with large glowing engraved text "LTX-2.3" centered and unobstructed, dramatic lighting, photorealism, sharp focus.\n- pc game, console game, video game, cartoon, childish, ugly',
      ),
      seed: v.seed(42),
      // on: the text encoder itself (gemma 3, abliterated lora) first rewrites the prompt into a detailed shot description
      enhance: v.toggle(true, 'enhance prompt'),
      // the OUTPUT size: the first pass samples at half of it, the latent upscaler doubles it
      size: v.size({ width: 1280, height: 720 }),
      // 8n + 1 frames; another count snaps to the closest valid one
      length: v.int(121, { min: 9, max: 481 }),
      fps: v.int(25, { min: 1, max: 60 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: CKPT })
      const clip = b.LTXAVTextEncoderLoader({
         text_encoder: 'gemma_3_12B_it_fp4_mixed.safetensors',
         ckpt_name: CKPT,
         device: 'default',
      })
      const audioVae = b.LTXVAudioVAELoader({ ckpt_name: CKPT })
      // the dev model at half strength of the distilled lora: cfg 1 and short sigma schedules on both passes
      const model = b.LoraLoaderModelOnly({
         model: ckpt.outputs.MODEL,
         lora_name: 'ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors',
         strength_model: 0.5,
      })

      const positiveText = vars.enhance
         ? b.TextGenerateLTX2Prompt({
              clip: b.LoraLoader({
                 model,
                 clip,
                 lora_name: 'gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors',
                 strength_model: 1,
                 strength_clip: 1,
              }).outputs.CLIP,
              prompt: vars.prompt.positive,
              max_length: 2048,
              sampling_mode: 'on',
              'sampling_mode.temperature': 0.7,
              'sampling_mode.top_k': 64,
              'sampling_mode.top_p': 0.95,
              'sampling_mode.min_p': 0.05,
              'sampling_mode.repetition_penalty': 1.05,
              'sampling_mode.seed': 0,
              thinking: true,
              use_default_template: true,
              mtp: 'auto',
           }).outputs.generated_text
         : vars.prompt.positive
      const cond = b.LTXVConditioning({
         positive: b.CLIPTextEncode({ clip, text: positiveText }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         frame_rate: vars.fps,
      })
      const sampler = b.KSamplerSelect({ sampler_name: 'euler' })
      const noise = b.RandomNoise({ noise_seed: vars.seed })

      // pass 1: video + audio latents sampled together at half resolution
      const base = b.SamplerCustomAdvanced({
         noise,
         guider: b.CFGGuider({ model, positive: cond.outputs.positive, negative: cond.outputs.negative, cfg: 1 }),
         sampler,
         sigmas: b.ManualSigmas({ sigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' }),
         latent_image: b.LTXVConcatAVLatent({
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
         }),
      })
      const baseAv = b.LTXVSeparateAVLatent({ av_latent: base.outputs.output })
      const cropped = b.LTXVCropGuides({
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         latent: baseAv.outputs.video_latent,
      })

      // pass 2: x2 latent upscale of the video, then a short refine over the rejoined av latent
      const refined = b.SamplerCustomAdvanced({
         noise,
         guider: b.CFGGuider({ model, positive: cropped.outputs.positive, negative: cropped.outputs.negative, cfg: 1 }),
         sampler,
         sigmas: b.ManualSigmas({ sigmas: '0.85, 0.7250, 0.4219, 0.0' }),
         latent_image: b.LTXVConcatAVLatent({
            video_latent: b.LTXVLatentUpsampler({
               samples: baseAv.outputs.video_latent,
               upscale_model: b.LatentUpscaleModelLoader({ model_name: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors' }),
               vae: ckpt.outputs.VAE,
            }),
            audio_latent: baseAv.outputs.audio_latent,
         }),
      })
      const av = b.LTXVSeparateAVLatent({ av_latent: refined.outputs.output })

      b.SaveVideo({
         video: b.CreateVideo({
            images: b.VAEDecodeTiled({
               samples: av.outputs.video_latent,
               vae: ckpt.outputs.VAE,
               tile_size: 768,
               overlap: 64,
               temporal_size: 4096,
               temporal_overlap: 4,
            }),
            audio: b.LTXVAudioVAEDecode({ samples: av.outputs.audio_latent, audio_vae: audioVae }),
            fps: vars.fps,
         }),
         filename_prefix: 'comfy-ts-zoo/ltx23-t2v',
         format: 'auto',
         codec: 'auto',
      })
   },
})

export default ltx23T2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ltx23T2v.vars.prompt.set(process.argv[2])
   if (process.argv[3]) ltx23T2v.vars.seed.set(Number(process.argv[3]))
   const execution = await ltx23T2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/ltx23-t2v`)
   host.disconnect()
}
