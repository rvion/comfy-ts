// txt2img on Comfy Cloud (https://cloud.comfy.org) — the managed catalog is
// the same for every account, so its sdk is COMMITTED at examples/comfy-cloud/sdk.d.ts
// (regenerate deliberately: bun run gen:sdk:cloud)
// needs COMFY_CLOUD_API_KEY in the env (cloud.comfy.org api key, paid tiers)
// run directly:  COMFY_CLOUD_API_KEY=… bun examples/05-comfy-cloud.cflow.ts ["prompt"] [seed]
import { ComfyTS, v } from 'comfy-ts'

const apiKey = process.env.COMFY_CLOUD_API_KEY
if (apiKey == null || apiKey === '')
   // the TUI surfaces an import throw as a red ✗ tree row with this message
   throw new Error(
      '[05-comfy-cloud] COMFY_CLOUD_API_KEY is not set — export your Comfy Cloud API key (https://cloud.comfy.org, paid tiers) to load this workflow',
   )

const comfy = ComfyTS.create()
const host = comfy.host({
   id: 'comfy-cloud',
   url: 'https://cloud.comfy.org',
   apiKey,
   // the cloud sdk home is the COMMITTED examples/comfy-cloud/sdk.d.ts — a second
   // copy under .comfy-ts/hosts/ would double-declare the globals
   sdkAutoWrite: false,
})
await host.loadSchemaFromCache() // offline import; run() connects lazily

export const cloudTxt2img = host.defineWorkflow({
   id: 'cloud-txt2img',
   vars: {
      prompt: v.text('a lighthouse on a cliff at dusk, dramatic clouds'),
      negative: v.text('blurry, low quality'),
      seed: v.seed(42),
      steps: v.int(12, { min: 1, max: 60 }),
      cfg: v.float(7, { min: 0, max: 30 }),
      size: v.size({ width: 512, height: 512 }),
      prefix: v.text('comfy-ts-cloud-example'),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'v1-5-pruned-emaonly-fp16.safetensors' })
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

export default cloudTxt2img

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) cloudTxt2img.vars.prompt.set(process.argv[2])
   if (process.argv[3]) cloudTxt2img.vars.seed.set(Number(process.argv[3]))

   const t0 = Date.now()
   const execution = await cloudTxt2img.run({ log: true })
   console.log(`🟢 done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${execution.images.length} image(s):`)
   for (const img of execution.images) console.log(`   ${img.absPath} (${img.width}x${img.height})`)
   host.disconnect()
}
