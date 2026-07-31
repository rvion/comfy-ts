// kandinsky5 i2v on Comfy Cloud — Kandinsky 5.0 Lite image to video, 5s @ 24fps from a start image
// source template: video_kandinsky5_i2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: video outputs PERSIST on the host (upstream ships no websocket saver for video — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/kandinsky5-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('walrus_1344x768.jpg'))

export const kandinsky5I2v = host.defineWorkflow({
   id: 'kandinsky5-i2v',
   vars: {
      image,
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'cinematic dynamic scene in deep blue dream haze: the camera glides slowly forward over starlight-sparkled translucent crystal flower buds swaying with misty currents, glimmering bokeh, quiet breath-like rhythm',
      ),
      seed: v.seed(42),
      steps: v.int(50, { min: 1, max: 60 }),
      cfg: v.float(5, { min: 0, max: 30 }),
      length: v.int(121, { min: 1, max: 241 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'kandinsky5lite_i2v_5s.safetensors', weight_dtype: 'default' }),
         shift: 5,
      })
      const clip = b.DualCLIPLoader({
         clip_name1: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         clip_name2: 'clip_l.safetensors',
         type: 'kandinsky5',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'hunyuan_video_vae_bf16.safetensors' })

      // the start image is scaled to the model's working resolution, then rides
      // the packaged conditioning + latent from the same node
      const start = b.ImageScale({ image: loaded, upscale_method: 'lanczos', crop: 'center', width: 768, height: 512 })
      const video = b.Kandinsky5ImageToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae,
         start_image: start,
         width: 768,
         height: 512,
         length: vars.length,
         batch_size: 1,
      })
      const samples = b.KSampler({
         model,
         positive: video.outputs.positive,
         negative: video.outputs.negative,
         latent_image: video.outputs.latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler_ancestral',
         scheduler: 'beta',
         denoise: 1,
      })
      // pin the sampled latent back onto the reference start frames, per the template
      const pinned = b.NormalizeVideoLatentStart({
         latent: b.ReplaceVideoLatentFrames({ destination: samples, source: video.outputs.cond_latent, index: 0 }),
         start_frame_count: 4,
         reference_frame_count: 5,
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples: pinned, vae }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/kandinsky5-i2v',
         format: 'mp4',
         codec: 'h264',
      })
   },
})

export default kandinsky5I2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) kandinsky5I2v.vars.image.set(process.argv[2])
   if (process.argv[3]) kandinsky5I2v.vars.prompt.set(process.argv[3])
   const execution = await kandinsky5I2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/kandinsky5-i2v`)
   host.disconnect()
}
