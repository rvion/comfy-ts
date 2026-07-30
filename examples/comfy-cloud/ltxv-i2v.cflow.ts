// ltxv i2v on Comfy Cloud — LTX-Video 2b (v0.9.5) image to video: a start image drives the first frame
// source template: ltxv_image_to_video.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/ltxv-i2v.cflow.ts [path/to/image.png] ["prompt"]
import { mkdirSync } from 'node:fs'
import { asAbsolutePath, ComfyTS, MediaImage, v } from 'comfy-ts'
import { dirname, resolve } from 'pathe'
import sharp from 'sharp'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

/** empty path → a generated flat-color placeholder (keeps the example self-contained) */
async function resolveInputImage(path: string): Promise<string> {
   if (path.trim() !== '') return resolve(path)
   const placeholder = ComfyTS.create().resolveFromOutput('ltxv-i2v-input.png')
   mkdirSync(dirname(placeholder), { recursive: true })
   await sharp({ create: { width: 768, height: 512, channels: 3, background: { r: 200, g: 90, b: 40 } } })
      .png()
      .toFile(placeholder)
   return placeholder
}

export const ltxvI2v = host.defineWorkflow({
   id: 'ltxv-i2v',
   vars: {
      image: v.text('', 'image path'),
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'A red fox moving gracefully, its russet coat vibrant against the white landscape, leaving perfect star-shaped prints behind as steam rises from its breath in the crisp winter air. The scene is wrapped in snow-muffled silence, broken only by the gentle murmur of water still flowing beneath the ice.\n- low quality, worst quality, deformed, distorted, disfigured, motion smear, motion artifacts, fused fingers, bad anatomy, weird hand, ugly',
      ),
      seed: v.seed(42),
      steps: v.int(30, { min: 1, max: 100 }),
      cfg: v.float(3, { min: 0, max: 30 }),
      length: v.int(97, { min: 9, max: 257 }),
      fps: v.int(24, { min: 1, max: 60 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(await resolveInputImage(vars.image)) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'ltx-video-2b-v0.9.5.safetensors' })
      const clip = b.CLIPLoader({ clip_name: 't5xxl_fp16.safetensors', type: 'ltxv', device: 'default' })
      // the start image is encoded into the video latent's first frame; strength 0.15
      // is the template's conditioning noise level, conditioning rides along
      const video = b.LTXVImgToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae: ckpt,
         image: loaded,
         width: 768,
         height: 512,
         length: vars.length,
         batch_size: 1,
         strength: 0.15,
      })
      // ltxv also conditions on the frame rate the model was trained against (template value)
      const cond = b.LTXVConditioning({
         positive: video.outputs.positive,
         negative: video.outputs.negative,
         frame_rate: 25,
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
            latent: video.outputs.latent,
         }),
         latent_image: video.outputs.latent,
         add_noise: true,
         noise_seed: vars.seed,
         cfg: vars.cfg,
      })
      b.SaveVideo({
         video: b.CreateVideo({ images: b.VAEDecode({ samples: samples.outputs.output, vae: ckpt }), fps: vars.fps }),
         filename_prefix: 'comfy-ts-zoo/ltxv-i2v',
         format: 'auto',
         codec: 'auto',
      })
   },
})

export default ltxvI2v

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ltxvI2v.vars.image.set(process.argv[2])
   if (process.argv[3]) ltxvI2v.vars.prompt.set(process.argv[3])
   const execution = await ltxvI2v.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
