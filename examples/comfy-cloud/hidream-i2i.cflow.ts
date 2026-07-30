// hidream i2i on Comfy Cloud — HiDream E1.1 instruction-driven image editing (ip2p conditioning + dual-cfg guider)
// source template: hidream_e1_1.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/hidream-i2i.cflow.ts [path/to/image.png] ["edit instruction"]
import { mkdirSync } from 'node:fs'
import { asAbsolutePath, ComfyTS, MediaImage, v } from 'comfy-ts'
import { dirname, resolve } from 'pathe'
import sharp from 'sharp'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

/** empty path → a generated flat-color placeholder (keeps the example self-contained) */
async function resolveInputImage(path: string): Promise<string> {
   if (path.trim() !== '') return resolve(path)
   const placeholder = ComfyTS.create().resolveFromOutput('example-input.png')
   mkdirSync(dirname(placeholder), { recursive: true })
   await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 210, g: 140, b: 80 } } })
      .png()
      .toFile(placeholder)
   return placeholder
}

export const hidreamI2i = host.defineWorkflow({
   id: 'hidream-i2i',
   vars: {
      image: v.text('', 'image path'),
      prompt: v.prompt('turn this into a watercolor painting\n- low quality, blurry, distorted'),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      // the template promotes both guider cfgs as top-level tweakables: cfg → cfg_conds, cfg2 → cfg_cond2_negative
      cfg: v.float(3, { min: 0, max: 20 }),
      cfg2: v.float(1.5, { min: 0, max: 20 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(await resolveInputImage(vars.image)) })
      const pixels = b.ImageScaleToTotalPixels({
         image: await img.loadInWorkflow_viaLoadImageNode(wf),
         upscale_method: 'area',
         megapixels: 1,
         resolution_steps: 1,
      })

      const clip = b.QuadrupleCLIPLoader({
         clip_name1: 'clip_g_hidream.safetensors',
         clip_name2: 'clip_l_hidream.safetensors',
         clip_name3: 't5xxl_fp8_e4m3fn_scaled.safetensors',
         clip_name4: 'llama_3.1_8b_instruct_fp8_scaled.safetensors',
      })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })
      const model = b.CFGNorm({
         model: b.UNETLoader({ unet_name: 'hidream_e1_1_bf16.safetensors', weight_dtype: 'fp8_e4m3fn_fast' }),
         strength: 1,
         pre_cfg: false,
      })

      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      // ip2p conditioning appends the input image latent to both text branches
      const cond = b.InstructPixToPixConditioning({
         positive,
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae,
         pixels,
      })
      // the guider's unconditional branch is the PLAIN positive encode (no image), exactly like the template
      const guider = b.DualCFGGuider({
         model,
         cond1: cond.outputs.positive,
         cond2: cond.outputs.negative,
         negative: positive,
         cfg_conds: vars.cfg,
         cfg_cond2_negative: vars.cfg2,
         style: 'regular',
      })
      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider,
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.BasicScheduler({ model, scheduler: 'simple', steps: vars.steps, denoise: 1 }),
         latent_image: cond.outputs.latent,
      })
      b.SaveImage({
         images: b.VAEDecode({ samples: samples.outputs.output, vae }),
         filename_prefix: 'comfy-ts-zoo/hidream-i2i',
      })
   },
})

export default hidreamI2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) hidreamI2i.vars.image.set(process.argv[2])
   if (process.argv[3]) hidreamI2i.vars.prompt.set(process.argv[3])
   const execution = await hidreamI2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
