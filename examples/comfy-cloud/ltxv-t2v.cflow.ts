// ltxv t2v on Comfy Cloud — LTX-Video 2b (v0.9) text to video, 97 frames @ 24fps ≈ 4s
// source template: ltxv_text_to_video.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/ltxv-t2v.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const ltxvT2v = host.defineWorkflow({
   id: 'ltxv-t2v',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         "A woman with long brown hair and light skin smiles at another woman with long blonde hair. The woman with brown hair wears a black jacket and has a small, barely noticeable mole on her right cheek. The camera angle is a close-up, focused on the woman with brown hair's face. The lighting is warm and natural, likely from the setting sun, casting a soft glow on the scene. The scene appears to be real-life footage.\n- low quality, worst quality, deformed, distorted, disfigured, motion smear, motion artifacts, fused fingers, bad anatomy, weird hand, ugly",
      ),
      seed: v.seed(42),
      steps: v.int(30, { min: 1, max: 100 }),
      cfg: v.float(3, { min: 0, max: 30 }),
      size: v.size({ width: 768, height: 512 }),
      length: v.int(97, { min: 9, max: 257 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'ltx-video-2b-v0.9.safetensors' })
      const clip = b.CLIPLoader({ clip_name: 't5xxl_fp16.safetensors', type: 'ltxv', device: 'default' })
      // ltxv also conditions on the frame rate the model was trained against (template value)
      const cond = b.LTXVConditioning({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         frame_rate: 25,
      })
      const latent = b.EmptyLTXVLatentVideo({
         width: vars.size.width,
         height: vars.size.height,
         length: vars.length,
         batch_size: 1,
      })
      const samples = b.SamplerCustom({
         model: ckpt,
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
         // ltxv wants its dedicated sigma schedule, stretched from the latent's token count
         sigmas: b.LTXVScheduler({
            steps: vars.steps,
            max_shift: 2.05,
            base_shift: 0.95,
            stretch: true,
            terminal: 0.1,
            latent,
         }),
         latent_image: latent,
         add_noise: true,
         noise_seed: vars.seed,
         cfg: vars.cfg,
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples: samples.outputs.output, vae: ckpt }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/ltxv-t2v',
         format: 'auto',
         codec: 'auto',
      })
   },
})

export default ltxvT2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ltxvT2v.vars.prompt.set(process.argv[2])
   if (process.argv[3]) ltxvT2v.vars.seed.set(Number(process.argv[3]))
   const execution = await ltxvT2v.run({ log: true })
   // SaveVideo outputs land host side (no auto-download for video yet)
   console.log(`🟢 ${execution.status}: video saved on the host under comfy-ts-zoo/ltxv-t2v`)
   host.disconnect()
}
