// flux1 i2i on Comfy Cloud — Flux.1 Kontext Dev image editing: reference latent steers the edit
// source template: flux_kontext_dev_basic.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/flux1-i2i.cflow.ts [path/to/image.png] ["prompt"]
import { mkdirSync } from 'node:fs'
import { asAbsolutePath, ComfyTS, MediaImage, v } from 'comfy-ts'
import { dirname, resolve } from 'pathe'
import sharp from 'sharp'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

/** empty path → a generated flat-color placeholder (keeps the example self-contained) */
async function resolveInputImage(path: string): Promise<string> {
   if (path.trim() !== '') return resolve(path)
   const placeholder = ComfyTS.create().resolveFromOutput('flux1-i2i-input.png')
   mkdirSync(dirname(placeholder), { recursive: true })
   await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 210, g: 140, b: 80 } } })
      .png()
      .toFile(placeholder)
   return placeholder
}

export const flux1I2i = host.defineWorkflow({
   id: 'flux1-i2i',
   vars: {
      image: v.text('', 'image path'),
      prompt: v.prompt('turn this into a watercolor painting, keep the composition'),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 50 }),
      guidance: v.float(2.5, { min: 0, max: 10 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(await resolveInputImage(vars.image)) })
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
      b.SaveImage({ images: b.VAEDecode({ samples, vae }), filename_prefix: 'comfy-ts-zoo/flux1-i2i' })
   },
})

export default flux1I2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) flux1I2i.vars.image.set(process.argv[2])
   if (process.argv[3]) flux1I2i.vars.prompt.set(process.argv[3])
   const execution = await flux1I2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
