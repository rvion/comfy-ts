// pixeldit t2i on Comfy Cloud — PixelDiT 1.3B, pixel-space diffusion (gemma 2 2B text encoder, no latent compression)
// source template: image_pixeldit_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/pixeldit-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const pixelditT2i = host.defineWorkflow({
   id: 'pixeldit-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A surreal architectural scene featuring a woman in a flowing white dress walking away from the viewer through a narrow canyon of smooth, organic beige rock formations, bright sunlight streaming from above, sharp shadows, clear deep blue sky, photorealistic, cinematic lighting\n- low quality, worst quality, over-saturated, blurry, deformed, watermark',
      ),
      seed: v.seed(42),
      steps: v.int(30, { min: 1, max: 60 }),
      cfg: v.float(4, { min: 0, max: 30 }),
      // the template's ResolutionSelector default: 1 megapixel, 1:1, snapped to a multiple of 8
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({
         clip_name: 'gemma_2_2b_it_elm_bf16.safetensors',
         type: 'pixeldit',
         device: 'default',
      })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'pixeldit_1300m_1024px_bf16.safetensors', weight_dtype: 'default' }),
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         // pixel-space model: chroma-radiance latents ARE pixels, decoded by the identity "pixel_space" vae
         latent_image: b.EmptyChromaRadianceLatentImage({
            width: vars.size.width,
            height: vars.size.height,
            batch_size: 1,
         }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'er_sde',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImage({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'pixel_space' }) }),
         filename_prefix: 'comfy-ts-zoo/pixeldit-t2i',
      })
   },
})

export default pixelditT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) pixelditT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) pixelditT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await pixelditT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
