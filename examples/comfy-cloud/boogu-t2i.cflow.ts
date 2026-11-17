// boogu t2i on Comfy Cloud — Boogu Image 0.1 Turbo fp8, 4-step distilled text to image (lcm, cfg 1, qwen3vl text encoder)
// source template: image_boogu_image_0_1_turbo_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/boogu-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const booguT2i = host.defineWorkflow({
   id: 'boogu-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Abstract close-up portrait of a young man wearing a cream turtleneck, captured with severe horizontal motion blur and double exposure effect that distorts his facial features, rendered in an analog film grain style with muted earthy background tones, framed tightly on his face to emphasize the blur streaks across his eyes, nose, and lips while retaining the texture of the knit collar and soft ambient lighting.',
      ),
      seed: v.seed(42),
      steps: v.int(4, { min: 1, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({ clip_name: 'qwen3vl_8b_fp8_scaled.safetensors', type: 'boogu', device: 'default' })
      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      // turbo distill: no negative lines → zeroed-out conditioning (the template's own default)
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: positive })
            : b.CLIPTextEncode({ clip, text: vars.prompt.negative })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'boogu_image_turbo_fp8_scaled.safetensors', weight_dtype: 'default' }),
         positive,
         negative,
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1,
         sampler_name: 'lcm',
         scheduler: 'sgm_uniform',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'ae.safetensors' }) }) })
   },
})

export default booguT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) booguT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) booguT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await booguT2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/boogu-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
