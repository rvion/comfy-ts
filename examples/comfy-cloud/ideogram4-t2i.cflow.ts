// ideogram4 t2i on Comfy Cloud — Ideogram 4.0 fp8, dual-model CFG text to image, typography-strong
// source template: image_ideogram4_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/ideogram4-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const ideogram4T2i = host.defineWorkflow({
   id: 'ideogram4-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         "A surreal streetwear collage poster: a relaxed skateboarder mid-air against a vibrant blue sky, giant puffy 3D letters spelling 'COMFY', torn paper banners reading 'STAY COZY', distressed red stamps, retro magazine cutout aesthetic",
      ),
      seed: v.seed(42),
      // template presets (steps/mu/std): Quality 48/0/1.5, Default 20/0/1.75, Turbo 12/0.5/1.75
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(7, { min: 0, max: 30 }),
      size: v.size({ width: 768, height: 1344 }),
   },
   build: (b, vars) => {
      const model = b.UNETLoader({ unet_name: 'ideogram4_fp8_scaled.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({
         clip_name: 'qwen3vl_8b_fp8_scaled.safetensors',
         type: 'ideogram4',
         device: 'default',
      })
      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      // no negative lines → zeroed-out conditioning (the template's own default)
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: positive })
            : b.CLIPTextEncode({ clip, text: vars.prompt.negative })
      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.DualModelGuider({
            // the template's schedule: cfg drops to 3 over the final 30% of sampling
            model: b.CFGOverride({ model, cfg: 3, start_percent: 0.7, end_percent: 1 }),
            positive,
            // the negative pass runs on a dedicated unconditional model (ideogram4's dual-model CFG)
            model_negative: b.UNETLoader({
               unet_name: 'ideogram4_unconditional_fp8_scaled.safetensors',
               weight_dtype: 'default',
            }),
            negative,
            cfg: vars.cfg,
         }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.Ideogram4Scheduler({
            steps: vars.steps,
            width: vars.size.width,
            height: vars.size.height,
            mu: 0,
            std: 1.75,
         }),
         latent_image: b.EmptyFlux2LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
      })
      b.SaveImage({
         images: b.VAEDecode({
            samples: samples.outputs.output,
            vae: b.VAELoader({ vae_name: 'flux2-vae.safetensors' }),
         }),
         filename_prefix: 'comfy-ts-zoo/ideogram4-t2i',
      })
   },
})

export default ideogram4T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ideogram4T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) ideogram4T2i.vars.seed.set(Number(process.argv[3]))
   const execution = await ideogram4T2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
