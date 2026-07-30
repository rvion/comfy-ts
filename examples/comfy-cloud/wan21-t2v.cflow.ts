// wan21 t2v on Comfy Cloud — Wan 2.1 1.3B text to video, 480p, 33 frames at 16 fps
// source template: text_to_video_wan.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/wan21-t2v.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const wan21T2v = host.defineWorkflow({
   id: 'wan21-t2v',
   vars: {
      // the `- ` line is the template's own wan negative (standard Chinese quality list)
      prompt: v.prompt(
         'a fox moving quickly in a beautiful winter scenery nature trees mountains daytime tracking camera\n- 色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
      ),
      seed: v.seed(42),
      steps: v.int(30, { min: 1, max: 60 }),
      cfg: v.float(6, { min: 0, max: 30 }),
      size: v.size({ width: 832, height: 480 }),
      length: v.int(33, { min: 1, max: 241 }),
      fps: v.int(16, { min: 1, max: 60 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'wan2.1_t2v_1.3B_fp16.safetensors', weight_dtype: 'default' }),
         shift: 8,
      })
      const clip = b.CLIPLoader({ clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'wan_2.1_vae.safetensors' })
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptyHunyuanLatentVideo({
            width: vars.size.width,
            height: vars.size.height,
            length: vars.length,
            batch_size: 1,
         }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'uni_pc',
         scheduler: 'simple',
         denoise: 1,
      })
      const video = b.CreateVideo({ images: b.VAEDecode({ samples, vae }), fps: vars.fps })
      b.SaveVideo({ video, filename_prefix: 'comfy-ts-zoo/wan21-t2v', format: 'auto', codec: 'auto' })
   },
})

export default wan21T2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) wan21T2v.vars.prompt.set(process.argv[2])
   if (process.argv[3]) wan21T2v.vars.seed.set(Number(process.argv[3]))
   const execution = await wan21T2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for videos yet)
   console.log(`🟢 ${execution.status} — video saved on the host under comfy-ts-zoo/wan21-t2v`)
   host.disconnect()
}
