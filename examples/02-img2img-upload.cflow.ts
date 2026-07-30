// upload a local image (hash-named, deduped) and run img2img on it
// run directly:  bun examples/02-img2img-upload.cflow.ts [path/to/image.png]
// in the TUI:    bun run tui — activate the `image` var to open the picker (browse, favorites, preview)
import { asAbsolutePath, ComfyTS, exampleImagePath, MediaImage, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('dog_512x512.jpg'))

export const img2img = host.defineWorkflow({
   id: 'img2img-upload',
   vars: {
      image,
      prompt: v.text('oil painting of a sunset over the sea'),
      negative: v.text('text, watermark'),
      seed: v.seed(7),
      steps: v.int(20, { min: 1, max: 60 }),
      denoise: v.float(0.65, { min: 0, max: 1 }),
      prefix: v.text('comfy-ts-img2img'),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'SD1.5\\v1-5-pruned-emaonly.ckpt' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: vars.negative }),
         latent_image: b.VAEEncode({ pixels: loaded, vae: ckpt }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 7,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: vars.denoise, // 0.65 keeps 35% of the input image
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae: ckpt }), filename_prefix: vars.prefix })
   },
})

export default img2img

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) img2img.vars.image.set(process.argv[2])

   const execution = await img2img.run({ log: true })
   for (const out of execution.images) console.log(`🟢 ${out.absPath}`)
   host.disconnect()
}
