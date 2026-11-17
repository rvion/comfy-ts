// krea2 i2i on Comfy Cloud — Krea 2 Turbo int8 + the style-reference lora: a new picture from the prompt, in the style of the input image (8 steps, cfg 1)
// source template: image_krea2_turbo_int8_image_style_reference.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/krea2-i2i.cflow.ts [path/to/style.png] ["prompt"] [seed]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const krea2I2i = host.defineWorkflow({
   id: 'krea2-i2i',
   vars: {
      // the STYLE reference: its look carries over, its content does not
      image,
      // ONE prompt var: what to draw, positive only (the negative is the zeroed-out positive)
      prompt: v.prompt('a white yeti with horns reading a book in a snowy forest'),
      seed: v.seed(42),
      steps: v.int(8, { min: 1, max: 40 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })
      const model = b.ModelSamplingFlux({
         model: b.LoraLoaderModelOnly({
            model: b.UNETLoader({ unet_name: 'krea2_turbo_int8_convrot.safetensors', weight_dtype: 'default' }),
            lora_name: 'krea2_style_reference.safetensors',
            strength_model: 1,
         }),
         max_shift: 1.15,
         base_shift: 0.5,
         width: vars.size.width,
         height: vars.size.height,
      })
      // the reference enters as an edit-style image latent, indexed at timestep zero
      const positive = b.FluxKontextMultiReferenceLatentMethod({
         conditioning: b.TextEncodeQwenImageEditPlus({
            clip: b.CLIPLoader({ clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default' }),
            vae,
            image1: loaded,
            prompt: vars.prompt.positive,
         }),
         reference_latents_method: 'index_timestep_zero',
      })
      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.CFGGuider({
            model,
            positive,
            negative: b.ConditioningZeroOut({ conditioning: positive }),
            cfg: 1,
         }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.BasicScheduler({ model, scheduler: 'simple', steps: vars.steps, denoise: 1 }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples: samples.outputs.output, vae }) })
   },
})

export default krea2I2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) krea2I2i.vars.image.set(process.argv[2])
   if (process.argv[3]) krea2I2i.vars.prompt.set(process.argv[3])
   if (process.argv[4]) krea2I2i.vars.seed.set(Number(process.argv[4]))
   const execution = await krea2I2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/krea2-i2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
