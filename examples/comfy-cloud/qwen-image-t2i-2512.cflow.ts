// qwen-image t2i 2512 on Comfy Cloud — Qwen-Image 2512 fp8, the 2512 refresh of the Qwen-Image weights (50 steps, cfg 4)
// source template: image_qwen_Image_2512.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/qwen-image-t2i-2512.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const qwenImageT2i2512 = host.defineWorkflow({
   id: 'qwen-image-t2i-2512',
   vars: {
      // ONE prompt var: the `- ` line is the template's own negative (a Chinese quality list)
      prompt: v.prompt(
         [
            'Urban alleyway at dusk. A tall high-fashion model striding elegantly, mid-distance full body shot from an angular perspective, editorial with bold contrasts and tactile materials. A rose-gold metallic trench coat over a black textured turtleneck, forest-green pleated pants with raw hems, long braided dark hair, a vibrant yellow designer handbag with geometric details, white architectural sneakers. High contrast, extreme clarity, photorealistic.',
            '- 低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲',
         ].join('\n'),
      ),
      seed: v.seed(42),
      // template defaults: 50 steps / cfg 4 (its optional 4-step Lightning lora branch ships off, dropped here)
      steps: v.int(50, { min: 1, max: 100 }),
      cfg: v.float(4, { min: 0, max: 30 }),
      size: v.size({ width: 1328, height: 1328 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingAuraFlow({
         model: b.UNETLoader({ unet_name: 'qwen_image_2512_fp8_e4m3fn.safetensors', weight_dtype: 'default' }),
         shift: 3.1,
      })
      const clip = b.CLIPLoader({
         clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
         type: 'qwen_image',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae }) })
   },
})

export default qwenImageT2i2512

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) qwenImageT2i2512.vars.prompt.set(process.argv[2])
   if (process.argv[3]) qwenImageT2i2512.vars.seed.set(Number(process.argv[3]))
   const execution = await qwenImageT2i2512.run({ log: true, save: { prefix: 'comfy-ts-zoo/qwen-image-t2i-2512' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
