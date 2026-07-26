// upload a local image (hash-named, deduped) and run img2img on it
// run directly:  bun examples/02-img2img-upload.cflow.ts [path/to/image.png]
// in the TUI:    bun run tui — the `image` var is a path; empty = generated placeholder
import { mkdirSync } from 'node:fs'
import { asAbsolutePath, ComfyTS, MediaImage, v } from 'comfy-ts'
import { dirname, resolve } from 'pathe'
import sharp from 'sharp'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: '127.0.0.1', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

/** empty path → a generated flat-color placeholder (keeps the example self-contained) */
async function resolveInputImage(path: string): Promise<string> {
   if (path.trim() !== '') return resolve(path)
   const placeholder = comfy.resolveFromOutput('example-input.png')
   mkdirSync(dirname(placeholder), { recursive: true })
   await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 210, g: 140, b: 80 } } })
      .png()
      .toFile(placeholder)
   return placeholder
}

export const img2img = host.defineWorkflow({
   id: 'img2img-upload',
   vars: {
      image: v.text('', 'image path'),
      prompt: v.text('oil painting of a sunset over the sea'),
      negative: v.text('text, watermark'),
      seed: v.seed(7),
      steps: v.int(20, { min: 1, max: 60 }),
      denoise: v.float(0.65, { min: 0, max: 1 }),
      prefix: v.text('comfy-ts-img2img'),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(await resolveInputImage(vars.image)) })
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
