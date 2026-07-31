// flux1 i2i on Comfy Cloud — Flux.1 Kontext Dev image editing: reference latent steers the edit
// source template: flux_kontext_dev_basic.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/flux1-i2i.cflow.ts [path/to/image.png] ["prompt"]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const flux1I2i = host.defineWorkflow({
   id: 'flux1-i2i',
   vars: {
      image,
      prompt: v.prompt('turn this into a watercolor painting, keep the composition'),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 50 }),
      guidance: v.float(2.5, { min: 0, max: 10 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const model = b.UNETLoader({ unet_name: 'flux1-dev-kontext_fp8_scaled.safetensors', weight_dtype: 'default' })
      const clip = b.DualCLIPLoader({
         clip_name1: 'clip_l.safetensors',
         clip_name2: 't5xxl_fp8_e4m3fn_scaled.safetensors',
         type: 'flux',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })

      // kontext wants its reference at a supported resolution; the edit denoises
      // fully (denoise 1) — the input steers through the reference latent
      const latent = b.VAEEncode({ pixels: b.FluxKontextImageScale({ image: loaded }), vae })

      const encoded = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      const positive = b.FluxGuidance({
         conditioning: b.ReferenceLatent({ conditioning: encoded, latent }),
         guidance: vars.guidance,
      })
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: encoded })
            : b.CLIPTextEncode({ clip, text: vars.prompt.negative })

      const samples = b.KSampler({
         model,
         positive,
         negative,
         latent_image: latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae }) })
   },
})

export default flux1I2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) flux1I2i.vars.image.set(process.argv[2])
   if (process.argv[3]) flux1I2i.vars.prompt.set(process.argv[3])
   const execution = await flux1I2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/flux1-i2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
