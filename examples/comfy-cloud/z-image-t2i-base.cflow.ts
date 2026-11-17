// z-image t2i base on Comfy Cloud — Z-Image base bf16, the undistilled model: 25 steps with real cfg and a negative prompt
// source template: image_z_image.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/z-image-t2i-base.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const zImageT2iBase = host.defineWorkflow({
   id: 'z-image-t2i-base',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A fashion photograph full of surreal romanticism, low-angle shot against a clear light blue sky. The vegetation is rendered in shades of blue, from ice blue to deep cobalt, with delicate realistic leaves; warm brown trunks contrast with the cool foliage like a dreamy forest from another world. A model in a yellow and white vertically striped long dress walks slowly on the sand, the noon sun casting clear shadows. Clean, transparent colors, quiet and poetic high-fashion mood.',
      ),
      seed: v.seed(42),
      steps: v.int(25, { min: 1, max: 80 }),
      cfg: v.float(4, { min: 1, max: 10 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingAuraFlow({
         model: b.UNETLoader({ unet_name: 'z_image_bf16.safetensors', weight_dtype: 'default' }),
         shift: 3,
      })
      const clip = b.CLIPLoader({ clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' })
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'res_multistep',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'ae.safetensors' }) }) })
   },
})

export default zImageT2iBase

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) zImageT2iBase.vars.prompt.set(process.argv[2])
   if (process.argv[3]) zImageT2iBase.vars.seed.set(Number(process.argv[3]))
   const execution = await zImageT2iBase.run({ log: true, save: { prefix: 'comfy-ts-zoo/z-image-t2i-base' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
