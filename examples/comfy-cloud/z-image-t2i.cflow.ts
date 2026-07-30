// z-image t2i on Comfy Cloud — Z-Image Turbo bf16, 8-step distilled text to image (cfg 1)
// source template: image_z_image_turbo.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/z-image-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const zImageT2i = host.defineWorkflow({
   id: 'z-image-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Latina female with thick wavy hair, harbor boats and pastel houses behind. Breezy seaside light, warm tones, cinematic close-up.',
      ),
      seed: v.seed(42),
      steps: v.int(8, { min: 1, max: 40 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingAuraFlow({
         model: b.UNETLoader({ unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' }),
         shift: 3,
      })
      const clip = b.CLIPLoader({ clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' })
      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      // turbo distill: no negative lines → zeroed-out conditioning (the template's own default)
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: positive })
            : b.CLIPTextEncode({ clip, text: vars.prompt.negative })
      const samples = b.KSampler({
         model,
         positive,
         negative,
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1,
         sampler_name: 'res_multistep',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'ae.safetensors' }) }),
         filename_prefix: 'comfy-ts-zoo/z-image-t2i',
      })
   },
})

export default zImageT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) zImageT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) zImageT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await zImageT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
