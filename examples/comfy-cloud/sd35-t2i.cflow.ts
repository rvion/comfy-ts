// sd35 t2i on Comfy Cloud — Stable Diffusion 3.5 Large fp8, single checkpoint text to image
// source template: sd3.5_simple_example.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/sd35-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const sd35T2i = host.defineWorkflow({
   id: 'sd35-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt('a bottle with a pink and red galaxy inside it on top of a wooden table in a modern kitchen'),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(4.01, { min: 0, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'sd3.5_large_fp8_scaled.safetensors' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt.negative }),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'sgm_uniform',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae: ckpt }), filename_prefix: 'comfy-ts-zoo/sd35-t2i' })
   },
})

export default sd35T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) sd35T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) sd35T2i.vars.seed.set(Number(process.argv[3]))
   const execution = await sd35T2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
