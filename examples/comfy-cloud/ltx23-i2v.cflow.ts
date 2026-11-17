// ltx23 i2v on Comfy Cloud — LTX-2.3 22b dev fp8 + its distilled lora, image to video WITH a generated soundtrack, two passes at cfg 1
// source template: video_ltx2_3_i2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: video outputs PERSIST on the host (upstream ships no websocket saver for video — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/ltx23-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('walrus_1344x768.jpg'))

const CKPT = 'ltx-2.3-22b-dev-fp8.safetensors'

export const ltx23I2v = host.defineWorkflow({
   id: 'ltx23-i2v',
   vars: {
      image,
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'The walrus lies on the rocks as the camera performs a single, smooth push-in, from a wide shot of the shore to a medium close frame, then holds. It lifts its head, shakes the water off its whiskers and lets out a deep, rumbling bellow. Waves break behind it, spray drifts in the wind, gulls call overhead. No pull-back; the only camera move is the continuous push-in.\n- pc game, console game, video game, cartoon, childish, ugly',
      ),
      seed: v.seed(42),
      // on: the text encoder itself (gemma 3, abliterated lora) first rewrites the prompt into a detailed shot description
      enhance: v.toggle(false, 'enhance prompt'),
      // the OUTPUT size: the start image is cropped to it, the first pass samples at half of it
      size: v.size({ width: 1280, height: 720 }),
      // 8n + 1 frames; another count snaps to the closest valid one
      length: v.int(121, { min: 9, max: 481 }),
      fps: v.int(25, { min: 1, max: 60 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

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

      // the start image: center-cropped to the output size, longest side to 1536, then re-compressed the way ltx was trained on video frames
      const start = b.LTXVPreprocess({
         image: b.ImageScaleToMaxDimension({
            image: b.ImageScale({
               image: loaded,
               upscale_method: 'lanczos',
               width: vars.size.width,
               height: vars.size.height,
               crop: 'center',
            }),
            upscale_method: 'area',
            largest_size: 1536,
         }),
         img_compression: 18,
      }).outputs.output_image

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
              thinking: false,
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

      // pass 1: half resolution, the start image written into the first frame at strength 0.7
      const base = b.SamplerCustomAdvanced({
         noise,
         guider: b.CFGGuider({ model, positive: cond.outputs.positive, negative: cond.outputs.negative, cfg: 1 }),
         sampler,
         sigmas: b.ManualSigmas({ sigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' }),
         latent_image: b.LTXVConcatAVLatent({
            video_latent: b.LTXVImgToVideoInplace({
               vae: ckpt.outputs.VAE,
               image: start,
               latent: b.EmptyLTXVLatentVideo({
                  width: Math.round(vars.size.width / 2),
                  height: Math.round(vars.size.height / 2),
                  length: vars.length,
                  batch_size: 1,
               }),
               strength: 0.7,
               bypass: false,
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

      // pass 2: x2 latent upscale, the start image pinned again at full strength, then a short refine
      const refined = b.SamplerCustomAdvanced({
         noise,
         guider: b.CFGGuider({ model, positive: cropped.outputs.positive, negative: cropped.outputs.negative, cfg: 1 }),
         sampler,
         sigmas: b.ManualSigmas({ sigmas: '0.85, 0.7250, 0.4219, 0.0' }),
         latent_image: b.LTXVConcatAVLatent({
            video_latent: b.LTXVImgToVideoInplace({
               vae: ckpt.outputs.VAE,
               image: start,
               latent: b.LTXVLatentUpsampler({
                  samples: baseAv.outputs.video_latent,
                  upscale_model: b.LatentUpscaleModelLoader({
                     model_name: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
                  }),
                  vae: ckpt.outputs.VAE,
               }),
               strength: 1,
               bypass: false,
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
         filename_prefix: 'comfy-ts-zoo/ltx23-i2v',
         format: 'auto',
         codec: 'auto',
      })
   },
})

export default ltx23I2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ltx23I2v.vars.image.set(process.argv[2])
   if (process.argv[3]) ltx23I2v.vars.prompt.set(process.argv[3])
   const execution = await ltx23I2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/ltx23-i2v`)
   host.disconnect()
}
