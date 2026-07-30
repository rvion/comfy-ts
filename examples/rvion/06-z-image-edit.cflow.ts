// z-image edit on windows-1 — reference-image editing via the omni encoder.
// NO official z-image edit template exists (corpus 2026-07-30): this wires
// TextEncodeZImageOmni's reference conditioning (vae + image1) over
// z_image_turbo_bf16, the only z-image weights on the host — swap the UNET
// when dedicated omni/edit weights land. Sampler mirrors image_z_image_turbo.
// run directly:  bun examples/rvion/06-z-image-edit.cflow.ts [path/to/image.png] ["edit instruction"]
import { asAbsolutePath, ComfyTS, exampleImagePath, MediaImage, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('lioness_768x768.jpg'))

export const zImageEdit = host.defineWorkflow({
   id: 'z-image-edit',
   vars: {
      image,
      // `- ` lines are the negative prompt (turbo default: zeroed-out conditioning)
      prompt: v.prompt('make it a snowy winter scene, falling snowflakes'),
      seed: v.seed(42),
      steps: v.int(8, { min: 1, max: 40 }),
      size: v.size({ width: 1024, height: 1024 }),
      prefix: v.text('z-image-edit'),
   },
   // async build: the reference image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const unet = b.UNETLoader({ unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({ clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'FLUX1\\ae.safetensors' })

      const positive = b.TextEncodeZImageOmni({
         clip,
         prompt: vars.prompt.positive,
         vae,
         image1: loaded,
         auto_resize_images: true,
      })
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: positive })
            : b.TextEncodeZImageOmni({ clip, prompt: vars.prompt.negative, vae, image1: loaded })

      const samples = b.KSampler({
         model: b.ModelSamplingAuraFlow({ model: unet, shift: 3 }),
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
      b.SaveImage({ images: b.VAEDecode({ samples, vae }), filename_prefix: vars.prefix })
   },
})

export default zImageEdit

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) zImageEdit.vars.image.set(process.argv[2])
   if (process.argv[3]) zImageEdit.vars.prompt.set(process.argv[3])

   const execution = await zImageEdit.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
