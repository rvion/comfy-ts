// sd15 t2i on Comfy Cloud — the reference zoo example (agent/examples.md)
// source template: default.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers) — loads fine without, run() needs it
// run directly:  bun examples/rvion/05-comfy-cloud.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from '../comfy-cloud/cloudHost.ts'

const host = await cloudHost()

export const sd15T2i = host.defineWorkflow({
   id: 'sd15-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt('a lighthouse on a cliff at dusk, dramatic clouds\n- blurry, low quality'),
      seed: v.seed(42),
      steps: v.int(12, { min: 1, max: 60 }),
      cfg: v.float(7, { min: 0, max: 30 }),
      size: v.size({ width: 512, height: 512 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'v1-5-pruned-emaonly-fp16.safetensors' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt.negative }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae: ckpt }), filename_prefix: 'comfy-ts-zoo/sd15-t2i' })
   },
})

export default sd15T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) sd15T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) sd15T2i.vars.seed.set(Number(process.argv[3]))

   const t0 = Date.now()
   const execution = await sd15T2i.run({ log: true })
   console.log(`🟢 done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${execution.images.length} image(s):`)
   for (const img of execution.images) console.log(`   ${img.absPath} (${img.width}x${img.height})`)
   host.disconnect()
}
