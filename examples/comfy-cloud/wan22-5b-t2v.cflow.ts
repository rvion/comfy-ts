// wan22-5b t2v on Comfy Cloud — Wan 2.2 5B ti2v, one compact model, 5s @ 24fps 1280x704
// source template: video_wan2_2_5B_ti2v.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/wan22-5b-t2v.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const wan225bT2v = host.defineWorkflow({
   id: 'wan22-5b-t2v',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Low contrast. In a retro 1970s-style subway station, a street musician plays in dim colors and rough textures. He wears an old jacket, playing guitar with focus. Commuters hurry by, and a small crowd gathers to listen. The camera slowly moves right, capturing the blend of music and city noise, with old subway signs and mottled walls in the background.\n- 色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(5, { min: 0, max: 30 }),
      size: v.size({ width: 1280, height: 704 }),
      length: v.int(121, { min: 1, max: 321 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({ clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'wan2.2_vae.safetensors' })
      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'wan2.2_ti2v_5B_fp16.safetensors', weight_dtype: 'default' }),
         shift: 8,
      })
      // ti2v latent: wire a start_image here and the same graph does image to video
      const latent = b.Wan22ImageToVideoLatent({
         vae,
         width: vars.size.width,
         height: vars.size.height,
         length: vars.length,
         batch_size: 1,
      })
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'uni_pc',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples, vae }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/wan22-5b-t2v',
      })
   },
})

export default wan225bT2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) wan225bT2v.vars.prompt.set(process.argv[2])
   if (process.argv[3]) wan225bT2v.vars.seed.set(Number(process.argv[3]))
   const execution = await wan225bT2v.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
