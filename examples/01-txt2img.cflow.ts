// generate an image from text, fully typed against the 'windows-1' host sdk
// run directly:  bun examples/01-txt2img.cflow.ts ["prompt"] [seed]
// in the TUI:    bun run tui   (scans **/*.cflow.ts, tweak vars, r to run)
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: '127.0.0.1', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

export const txt2img = host.defineWorkflow({
   id: 'txt2img',
   vars: {
      prompt: v.text('a cozy house in a snowy forest, warm windows'),
      negative: v.text('blurry, low quality'),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(7, { min: 0, max: 30 }),
      size: v.size({ width: 512, height: 512 }),
      prefix: v.text('comfy-ts-example'),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'SD1.5\\v1-5-pruned-emaonly.ckpt' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: vars.negative }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae: ckpt }), filename_prefix: vars.prefix })
   },
})

export default txt2img

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) txt2img.vars.prompt.set(process.argv[2])
   if (process.argv[3]) txt2img.vars.seed.set(Number(process.argv[3]))

   const execution = await txt2img.run({ log: true })
   console.log(`🟢 done — ${execution.images.length} image(s):`)
   for (const img of execution.images) console.log(`   ${img.absPath} (${img.width}x${img.height})`)
   host.disconnect()
}
