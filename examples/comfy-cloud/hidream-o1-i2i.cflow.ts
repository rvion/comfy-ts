// hidream-o1 i2i on Comfy Cloud — HiDream-O1 Image dev fp8, instruction edit from a reference image (28 LCM steps, cfg 1)
// source template: image_hidream_o1_dev.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/hidream-o1-i2i.cflow.ts [path/to/image.png] ["edit prompt"] [seed]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('walrus_1344x768.jpg'))

export const hidreamO1I2i = host.defineWorkflow({
   id: 'hidream-o1-i2i',
   vars: {
      image,
      // ONE prompt var: the edit instruction; `- ` lines are the NEGATIVE prompt
      prompt: v.prompt(
         'Transform the background into a rainy neon city street at night, with wet asphalt reflections and blurred neon signs',
      ),
      seed: v.seed(42),
      steps: v.int(28, { min: 1, max: 100 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'hidream_o1_image_dev_fp8_scaled.safetensors' })
      // the dev model was trained at noise scale 7.6
      const model = b.ModelNoiseScale({ model: ckpt.outputs.MODEL, noise_scale: 7.6 })
      const clip = ckpt.outputs.CLIP
      // the reference rides on both conditionings (up to 10 references: images.image_2, …)
      const cond = b.HiDreamO1ReferenceImages({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         'images.image_1': loaded,
      })
      const samples = b.SamplerCustom({
         model,
         add_noise: true,
         noise_seed: vars.seed,
         // distilled: cfg 1, an LCM sampler with clipped noise
         cfg: 1,
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         sampler: b.SamplerLCM({ s_noise: 1, s_noise_end: 1, noise_clip_std: 2.5 }),
         sigmas: b.BasicScheduler({ model, scheduler: 'normal', steps: vars.steps, denoise: 1 }),
         // the output keeps the reference's size, floored to the 32 px grid
         latent_image: b.EmptyHiDreamO1LatentImage({
            width: Math.floor(img.width_orCrash / 32) * 32,
            height: Math.floor(img.height_orCrash / 32) * 32,
            batch_size: 1,
         }),
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples: samples.outputs.output, vae: ckpt.outputs.VAE }) })
   },
})

export default hidreamO1I2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) hidreamO1I2i.vars.image.set(process.argv[2])
   if (process.argv[3]) hidreamO1I2i.vars.prompt.set(process.argv[3])
   if (process.argv[4]) hidreamO1I2i.vars.seed.set(Number(process.argv[4]))
   const execution = await hidreamO1I2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/hidream-o1-i2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
