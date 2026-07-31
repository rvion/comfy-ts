// omnigen2 i2i on Comfy Cloud — OmniGen2 fp16 image edit, reference-latent dual CFG
// source template: image_omnigen2_image_edit.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/omnigen2-i2i.cflow.ts [path/to/image.png] ["edit prompt"] [seed]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const omnigen2I2i = host.defineWorkflow({
   id: 'omnigen2-i2i',
   vars: {
      image,
      prompt: v.prompt(
         'Transform character into crystal material, transparent crystal texture, sparkling surface, prismatic light effects, magical appearance, elegant translucent look\n- deformed, blurry, over saturation, bad anatomy, disfigured, poorly drawn face, mutation, extra limb, ugly, poorly drawn hands, fused fingers',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(5, { min: 0, max: 30 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const model = b.UNETLoader({ unet_name: 'omnigen2_fp16.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({ clip_name: 'qwen_2.5_vl_fp16.safetensors', type: 'omnigen2', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })

      // reference image → ~1MP; its size drives the output latent
      const scaled = b.ImageScaleToTotalPixels({
         image: loaded,
         upscale_method: 'area',
         megapixels: 1,
         resolution_steps: 1,
      })
      const size = b.GetImageSize({ image: scaled })
      const reference = b.VAEEncode({ pixels: scaled, vae })

      // dual CFG: cond1/cond2 see the reference latent, the plain negative does not (template wiring)
      const negative = b.CLIPTextEncode({ clip, text: vars.prompt.negative })
      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.DualCFGGuider({
            model,
            cond1: b.ReferenceLatent({
               conditioning: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
               latent: reference,
            }),
            cond2: b.ReferenceLatent({ conditioning: negative, latent: reference }),
            negative,
            cfg_conds: vars.cfg,
            cfg_cond2_negative: 2,
            style: 'regular',
         }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.BasicScheduler({ model, scheduler: 'simple', steps: vars.steps, denoise: 1 }),
         latent_image: b.EmptySD3LatentImage({
            width: size.outputs.width,
            height: size.outputs.height,
            batch_size: 1,
         }),
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples: samples.outputs.output, vae }) })
   },
})

export default omnigen2I2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) omnigen2I2i.vars.image.set(process.argv[2])
   if (process.argv[3]) omnigen2I2i.vars.prompt.set(process.argv[3])
   if (process.argv[4]) omnigen2I2i.vars.seed.set(Number(process.argv[4]))

   const execution = await omnigen2I2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/omnigen2-i2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
