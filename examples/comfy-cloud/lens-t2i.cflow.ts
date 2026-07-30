// lens t2i on Comfy Cloud — Lens Turbo bf16 (Flux-style UNET), 4-step distilled text to image (cfg 1)
// source template: image_lens_turbo_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/lens-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const lensT2i = host.defineWorkflow({
   id: 'lens-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A stylish vintage Porsche driving through a rainy neon city street at night, reflections shimmering across wet pavement, wide neon sign displaying "ComfyUI", glowing shop sign reading "Lens", cinematic atmosphere, moody retro lighting, analog film grain, 1980s movie still aesthetic',
      ),
      seed: v.seed(42),
      steps: v.int(4, { min: 1, max: 20 }),
      // the template's ResolutionSelector default: 2 megapixels, 1:1, snapped to a multiple of 8
      size: v.size({ width: 1448, height: 1448 }),
   },
   build: (b, vars) => {
      const shifted = b.ModelSamplingFlux({
         model: b.UNETLoader({ unet_name: 'lens_turbo_bf16.safetensors', weight_dtype: 'default' }),
         max_shift: 1.15,
         base_shift: 0.5,
         width: vars.size.width,
         height: vars.size.height,
      })
      const clip = b.CLIPLoader({ clip_name: 'gpt_oss_20b_nvfp4.safetensors', type: 'lens', device: 'default' })
      const samples = b.SamplerCustom({
         model: b.CFGNorm({ model: shifted, strength: 1, pre_cfg: false }),
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.BasicScheduler({ model: shifted, scheduler: 'simple', steps: vars.steps, denoise: 1 }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         add_noise: true,
         noise_seed: vars.seed,
         cfg: 1,
      })
      b.SaveImage({
         images: b.VAEDecode({
            samples: samples.outputs.output,
            vae: b.VAELoader({ vae_name: 'flux2-vae.safetensors' }),
         }),
         filename_prefix: 'comfy-ts-zoo/lens-t2i',
      })
   },
})

export default lensT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) lensT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) lensT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await lensT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
