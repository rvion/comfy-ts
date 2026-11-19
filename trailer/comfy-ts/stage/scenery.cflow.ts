import { ComfyTS, v } from 'comfy-ts'
const host = ComfyTS.create().host({ id: 'my-gpu', host: '127.0.0.1', port: 8085 })

export const scenery = host.defineWorkflow({
   id: 'scenery',
   vars: {
      prompt: v.prompt('a lighthouse on a cliff at dusk, rain, stormy sea\n- blurry, text, watermark'),
      seed: v.seed(7, { mode: '+' }),
      night: v.toggle(false, 'night'),
      upscale: v.toggle(false, 'upscale 2x'),
   },
   build: (b, vars) => {
      let text = `masterpiece, best quality, safe, no humans, scenery, ${vars.prompt.positive}`
      if (vars.night) text += ', night, moonlight'
      const clip = b.CLIPLoader({ clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion', device: 'default' })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'anima-turbo-v1.1.safetensors', weight_dtype: 'default' }),
         positive: b.CLIPTextEncode({ clip, text }),
         negative: b.CLIPTextEncode({ clip, text: `worst quality, low quality, 1girl, 1boy, ${vars.prompt.negative}` }),
         latent_image: b.EmptyLatentImage({ width: 1024, height: 768, batch_size: 1 }),
         seed: vars.seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      })
      let image = b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' }) })._IMAGE
      if (vars.upscale) image = b.ImageScaleBy({ image, upscale_method: 'lanczos', scale_by: 2 })._IMAGE
      b.SaveImageWebsocket({ images: image })
   },
})

export default scenery
