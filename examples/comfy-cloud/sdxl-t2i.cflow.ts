// sdxl t2i on Comfy Cloud — SDXL base + refiner, two stage KSamplerAdvanced handoff
// source template: sdxl_simple_example.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/sdxl-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const sdxlT2i = host.defineWorkflow({
   id: 'sdxl-t2i',
   vars: {
      prompt: v.prompt('evening sunset scenery blue sky nature, glass bottle with a galaxy in it\n- text, watermark'),
      seed: v.seed(42),
      steps: v.int(25, { min: 1, max: 60 }),
      // base samples steps 0..refinerStart with leftover noise, refiner finishes refinerStart..steps
      refinerStart: v.int(20, { min: 0, max: 60 }),
      cfg: v.float(8, { min: 0, max: 30 }),
      // SDXL trained resolutions: 1024x1024, 1152x896, 1216x832, 1344x768, 1536x640 (and flipped)
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const base = b.CheckpointLoaderSimple({ ckpt_name: 'sd_xl_base_1.0.safetensors' })
      const refiner = b.CheckpointLoaderSimple({ ckpt_name: 'sd_xl_refiner_1.0.safetensors' })
      const baseSamples = b.KSamplerAdvanced({
         model: base,
         positive: b.CLIPTextEncode({ clip: base, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip: base, text: vars.prompt.negative }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         add_noise: 'enable',
         noise_seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'normal',
         start_at_step: 0,
         end_at_step: vars.refinerStart,
         return_with_leftover_noise: 'enable',
      })
      const samples = b.KSamplerAdvanced({
         model: refiner,
         positive: b.CLIPTextEncode({ clip: refiner, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip: refiner, text: vars.prompt.negative }),
         latent_image: baseSamples,
         add_noise: 'disable',
         noise_seed: 0,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'normal',
         start_at_step: vars.refinerStart,
         end_at_step: 10000,
         return_with_leftover_noise: 'disable',
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae: refiner }), filename_prefix: 'comfy-ts-zoo/sdxl-t2i' })
   },
})

export default sdxlT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) sdxlT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) sdxlT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await sdxlT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
