// the workflow the trailer's live shots run: scenery, text to image with Anima turbo on a ComfyUI at 127.0.0.1:8085
import { ComfyTS, v } from 'comfy-ts'

const host = ComfyTS.create().host({ id: 'my-gpu', host: '127.0.0.1', port: 8085 })
await host.loadSchemaFromCache()

export const scenery = host.defineWorkflow({
   id: 'scenery',
   vars: {
      prompt: v.prompt('a lighthouse on a cliff at dusk, rain, stormy sea\n- blurry, text, watermark'),
      seed: v.seed(7, { mode: '+' }),
      size: v.size({ width: 1024, height: 768 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({ clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion', device: 'default' })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'anima-turbo-v1.1.safetensors', weight_dtype: 'default' }),
         positive: b.CLIPTextEncode({ clip, text: `masterpiece, best quality, safe, no humans, scenery, ${vars.prompt.positive}` }),
         negative: b.CLIPTextEncode({ clip, text: `worst quality, low quality, 1girl, 1boy, ${vars.prompt.negative}` }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: 8,
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' }) }) })
   },
})

export default scenery
