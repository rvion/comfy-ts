// ltx25 i2v on Comfy Cloud — LTX-2.5 22b distilled, image to video WITH a generated soundtrack: the start image drives both passes
// source template: video_ltx2_5_i2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: video outputs PERSIST on the host (upstream ships no websocket saver for video — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/ltx25-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('walrus_1344x768.jpg'))

export const ltx25I2v = host.defineWorkflow({
   id: 'ltx25-i2v',
   vars: {
      image,
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'The walrus slowly lifts its head and turns toward the camera, whiskers twitching, breath fogging in the cold air. Waves lap against the rocks behind it, gulls cry in the distance, and it lets out a deep, rumbling bellow.\n- pc game, console game, video game, cartoon, childish, ugly',
      ),
      seed: v.seed(42),
      // the OUTPUT size: the first pass samples at half of it, the latent upscaler doubles it
      size: v.size({ width: 1280, height: 704 }),
      length: v.int(121, { min: 9, max: 481 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const model = b.UNETLoader({
         unet_name: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
         weight_dtype: 'default',
      })
      const clip = b.CLIPLoader({
         clip_name: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
         type: 'ltxv',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'ltx-2.5-video-vae-bf16.safetensors' })
      const audioVae = b.VAELoader({ vae_name: 'ltx-2.5-audio-vae-bf16.safetensors' })

      // the start image, capped at 1536px and re-compressed the way ltx was trained on video frames
      const start = b.LTXVPreprocess({
         image: b.ImageScaleToMaxDimension({ image: loaded, upscale_method: 'lanczos', largest_size: 1536 }),
         img_compression: 18,
      }).outputs.output_image

      const cond = b.LTXVConditioning({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         frame_rate: vars.fps,
      })
      // distilled: cfg 1 on both streams, and hand-set sigma schedules instead of a step count
      const guider = b.LTXVDualCFGGuider({
         model,
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         video_cfg: 1,
         audio_cfg: 1,
      })
      const sampler = b.KSamplerSelect({ sampler_name: 'euler_ancestral' })
      const noise = b.RandomNoise({ noise_seed: vars.seed })

      // pass 1: half resolution, the start image written into the first frame at strength 0.7
      const base = b.SamplerCustomAdvanced({
         noise,
         guider,
         sampler,
         sigmas: b.ManualSigmas({ sigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' }),
         latent_image: b.LTXVConcatAVLatent({
            video_latent: b.LTXVImgToVideoInplace({
               vae,
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

      // pass 2: x2 latent upscale, the start image pinned again at full strength, then a short refine
      const refined = b.SamplerCustomAdvanced({
         noise,
         guider,
         sampler,
         sigmas: b.ManualSigmas({ sigmas: '0.85, 0.7250, 0.4219, 0.0' }),
         latent_image: b.LTXVConcatAVLatent({
            video_latent: b.LTXVImgToVideoInplace({
               vae,
               image: start,
               latent: b.LTXVLatentUpsampler({
                  samples: baseAv.outputs.video_latent,
                  upscale_model: b.LatentUpscaleModelLoader({
                     model_name: 'ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors',
                  }),
                  vae,
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
               vae,
               tile_size: 512,
               overlap: 64,
               temporal_size: 64,
               temporal_overlap: 16,
            }),
            audio: b.LTXVAudioVAEDecode({ samples: av.outputs.audio_latent, audio_vae: audioVae }),
            fps: vars.fps,
         }),
         filename_prefix: 'comfy-ts-zoo/ltx25-i2v',
         format: 'auto',
         codec: 'auto',
      })
   },
})

export default ltx25I2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ltx25I2v.vars.image.set(process.argv[2])
   if (process.argv[3]) ltx25I2v.vars.prompt.set(process.argv[3])
   const execution = await ltx25I2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/ltx25-i2v`)
   host.disconnect()
}
