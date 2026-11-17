// hidream-o1 t2i on Comfy Cloud — HiDream-O1 Image base bf16, native 2K text to image (40 steps, cfg 5, seam smoothing on the last 20%)
// source template: image_hidream_o1.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/hidream-o1-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const hidreamO1T2i = host.defineWorkflow({
   id: 'hidream-o1-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Graceful female skincare shot, light natural makeup, holding an essence bottle, warm ivory backdrop, soft diffused light',
      ),
      seed: v.seed(42),
      steps: v.int(40, { min: 1, max: 100 }),
      cfg: v.float(5, { min: 1, max: 15 }),
      // trained sizes: 2048x2048, 2304x1728, 2304x1792, 2496x1664, 2560x1440, 3104x1312 and their portrait twins
      size: v.size({ width: 2048, height: 2048 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'hidream_o1_image_bf16.safetensors' })
      // the base model was trained at noise scale 8
      const scaled = b.ModelNoiseScale({ model: ckpt.outputs.MODEL, noise_scale: 8 })
      const clip = ckpt.outputs.CLIP
      const samples = b.SamplerCustom({
         // the patch-grid seam blend runs over the last 20% of the steps only
         model: b.HiDreamO1PatchSeamSmoothing({
            model: scaled,
            start_percent: 0.8,
            end_percent: 1,
            pattern: 'single_shift',
            passes: 'ramp_2_4',
            blend: 'median',
            strength: 1,
         }),
         add_noise: true,
         noise_seed: vars.seed,
         cfg: vars.cfg,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         sampler: b.KSamplerSelect({ sampler_name: 'dpmpp_2m_sde_gpu' }),
         sigmas: b.BasicScheduler({ model: scaled, scheduler: 'normal', steps: vars.steps, denoise: 1 }),
         latent_image: b.EmptyHiDreamO1LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples: samples.outputs.output, vae: ckpt.outputs.VAE }) })
   },
})

export default hidreamO1T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) hidreamO1T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) hidreamO1T2i.vars.seed.set(Number(process.argv[3]))
   const execution = await hidreamO1T2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/hidream-o1-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
