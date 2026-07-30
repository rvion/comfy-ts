// svd i2v on Comfy Cloud — Stable Video Diffusion (svd_xt), 25 frames from a still image, no text prompt
// source template: txt_to_image_to_video.json (official workflow-templates), SDXL t2i half replaced by LoadImage
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/svd-i2v.cflow.ts [path/to/image.png] [seed]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('walrus_1344x768.jpg'))

export const svdI2v = host.defineWorkflow({
   id: 'svd-i2v',
   // no prompt var: SVD conditions on the image alone (clip vision), there is no text branch
   vars: {
      image,
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(2.5, { min: 0, max: 30 }),
      length: v.int(25, { min: 1, max: 25 }),
      fps: v.int(10, { min: 1, max: 60 }),
      motion: v.int(127, { min: 1, max: 1023 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const ckpt = b.ImageOnlyCheckpointLoader({ ckpt_name: 'svd_xt.safetensors' })
      // SVD_img2vid_Conditioning resizes init_image to width x height itself, no scale node needed
      const video = b.SVD_img2vid_Conditioning({
         clip_vision: ckpt,
         init_image: loaded,
         vae: ckpt,
         width: 1024,
         height: 576,
         video_frames: vars.length,
         motion_bucket_id: vars.motion,
         fps: 6,
         augmentation_level: 0,
      })
      const samples = b.KSampler({
         model: b.VideoLinearCFGGuidance({ model: ckpt, min_cfg: 1 }),
         positive: video.outputs.positive,
         negative: video.outputs.negative,
         latent_image: video.outputs.latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'karras',
         denoise: 1,
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples, vae: ckpt }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/svd-i2v',
         format: 'auto',
         codec: 'auto',
      })
   },
})

export default svdI2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) svdI2v.vars.image.set(process.argv[2])
   if (process.argv[3]) svdI2v.vars.seed.set(Number(process.argv[3]))
   const execution = await svdI2v.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
