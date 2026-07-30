// longcat t2i on Comfy Cloud — LongCat-Image (Meituan), flux-style guidance + real negative branch (cfg 4)
// source template: image_longcat_text_to_image.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/longcat-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const longcatT2i = host.defineWorkflow({
   id: 'longcat-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'high-fashion portrait of a man with a shaved head, round amber sunglasses, dark green turtleneck, monochromatic teal light, solid burnt orange background, hard directional lighting, editorial photography, 8K\n- blurry, low resolution, oversaturated, distorted face, watermark, text, logo',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(4, { min: 0, max: 30 }),
      guidance: v.float(4, { min: 0, max: 20 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({
         clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         type: 'longcat_image',
         device: 'default',
      })
      const encode = (text: string) =>
         b.FluxGuidance({ conditioning: b.CLIPTextEncode({ clip, text }), guidance: vars.guidance })
      const model = b.CFGNorm({
         model: b.UNETLoader({ unet_name: 'longcat_image_bf16.safetensors', weight_dtype: 'default' }),
         strength: 1,
         pre_cfg: false,
      })
      const samples = b.KSampler({
         model,
         positive: encode(vars.prompt.positive),
         negative: encode(vars.prompt.negative),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'ae.safetensors' }) }),
         filename_prefix: 'comfy-ts-zoo/longcat-t2i',
      })
   },
})

export default longcatT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) longcatT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) longcatT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await longcatT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
