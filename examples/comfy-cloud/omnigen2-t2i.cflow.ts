// omnigen2 t2i on Comfy Cloud — OmniGen2 fp16, dual-CFG text to image
// source template: image_omnigen2_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/omnigen2-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const omnigen2T2i = host.defineWorkflow({
   id: 'omnigen2-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A cat with a crown lounging on a velvet throne, royal atmosphere, luxurious fabric texture, regal pose, detailed fur, ornate crown, dramatic lighting\n- blurry, low quality, distorted, ugly, bad anatomy, deformed, poorly drawn',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(5, { min: 0, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.UNETLoader({ unet_name: 'omnigen2_fp16.safetensors', weight_dtype: 'default' })
      const clip = b.CLIPLoader({ clip_name: 'qwen_2.5_vl_fp16.safetensors', type: 'omnigen2', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })

      // OmniGen2 samples through a dual-CFG guider; without a reference image cond2 doubles the negative
      const negative = b.CLIPTextEncode({ clip, text: vars.prompt.negative })
      const samples = b.SamplerCustomAdvanced({
         noise: b.RandomNoise({ noise_seed: vars.seed }),
         guider: b.DualCFGGuider({
            model,
            cond1: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
            cond2: negative,
            negative,
            cfg_conds: vars.cfg,
            cfg_cond2_negative: 2,
            style: 'regular',
         }),
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         sigmas: b.BasicScheduler({ model, scheduler: 'simple', steps: vars.steps, denoise: 1 }),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples: samples.outputs.output, vae }) })
   },
})

export default omnigen2T2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) omnigen2T2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) omnigen2T2i.vars.seed.set(Number(process.argv[3]))

   const execution = await omnigen2T2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/omnigen2-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
