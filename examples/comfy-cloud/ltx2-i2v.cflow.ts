// ltx2 i2v on Comfy Cloud — LTX-2 19b dev fp8, image to video WITH a generated soundtrack: a cfg pass, then a distilled-lora refine at x2
// source template: video_ltx2_i2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: video outputs PERSIST on the host (upstream ships no websocket saver for video — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/ltx2-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('walrus_1344x768.jpg'))

const CKPT = 'ltx-2-19b-dev-fp8.safetensors'

export const ltx2I2v = host.defineWorkflow({
   id: 'ltx2-i2v',
   vars: {
      image,
      // ONE prompt var: describe actions over time, visuals AND sounds; `- ` lines are the NEGATIVE prompt
      prompt: v.prompt(
         'The walrus slowly raises its head and looks around, whiskers twitching, its breath fogging in the cold air. Waves roll in and break on the rocks behind it, gulls call overhead, and it lets out a deep, rumbling bellow.\n- blurry, low quality, still frame, frames, watermark, overlay, titles, has blurbox, has subtitles',
      ),
      seed: v.seed(42),
      // pass 1 only: the refine pass runs a fixed distilled schedule
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(4, { min: 1, max: 10 }),
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
         img_compression: 33,
      }).outputs.output_image

      const cond = b.LTXVConditioning({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         frame_rate: vars.fps,
      })
      const noise = b.RandomNoise({ noise_seed: vars.seed })

      // pass 1: the dev model with real cfg at half resolution, the start image written into the first frame
      const avLatent = b.LTXVConcatAVLatent({
         video_latent: b.LTXVImgToVideoInplace({
            vae: ckpt.outputs.VAE,
            image: start,
            latent: b.EmptyLTXVLatentVideo({
               width: Math.round(vars.size.width / 2),
               height: Math.round(vars.size.height / 2),
               length: vars.length,
               batch_size: 1,
            }),
            strength: 1,
            bypass: false,
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
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
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

      // pass 2: x2 latent upscale, the start image pinned again, then a short refine with the distilled lora at cfg 1
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
         sampler: b.KSamplerSelect({ sampler_name: 'gradient_estimation' }),
         sigmas: b.ManualSigmas({ sigmas: '0.909375, 0.725, 0.421875, 0.0' }),
         latent_image: b.LTXVConcatAVLatent({
            video_latent: b.LTXVImgToVideoInplace({
               vae: ckpt.outputs.VAE,
               image: start,
               latent: b.LTXVLatentUpsampler({
                  samples: cropped.outputs.latent,
                  upscale_model: b.LatentUpscaleModelLoader({
                     model_name: 'ltx-2-spatial-upscaler-x2-1.0.safetensors',
                  }),
                  vae: ckpt.outputs.VAE,
               }),
               strength: 1,
               bypass: false,
            }),
            audio_latent: baseAv.outputs.audio_latent,
         }),
      })
      const av = b.LTXVSeparateAVLatent({ av_latent: refined.outputs.denoised_output })

      b.SaveVideo({
         video: b.CreateVideo({
            images: b.VAEDecode({ samples: av.outputs.video_latent, vae: ckpt.outputs.VAE }),
            audio: b.LTXVAudioVAEDecode({ samples: av.outputs.audio_latent, audio_vae: audioVae }),
            fps: vars.fps,
         }),
         filename_prefix: 'comfy-ts-zoo/ltx2-i2v',
         format: 'auto',
         codec: 'auto',
      })
   },
})

export default ltx2I2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ltx2I2v.vars.image.set(process.argv[2])
   if (process.argv[3]) ltx2I2v.vars.prompt.set(process.argv[3])
   const execution = await ltx2I2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/ltx2-i2v`)
   host.disconnect()
}
