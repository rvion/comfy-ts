// chronoedit i2i on Comfy Cloud — NVIDIA ChronoEdit 14B (a Wan2.1 i2v fine-tune): the edit is the last frame of a 5-frame video from the input image
// source template: image_chrono_edit_14B.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/chronoedit-i2i.cflow.ts [path/to/image.png] ["edit prompt"] [seed]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('lioness_768x768.jpg'))

export const chronoeditI2i = host.defineWorkflow({
   id: 'chronoedit-i2i',
   vars: {
      image,
      // ONE prompt var: describe the edited picture; the `- ` line is the template's own wan negative (standard Chinese quality list)
      prompt: v.prompt(
         [
            'The lioness wears a small golden crown, same pose, same background, photorealistic, high detail.',
            '- 色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
         ].join('\n'),
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(4, { min: 1, max: 10 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const clip = b.CLIPLoader({ clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' })
      const vae = b.VAELoader({ vae_name: 'wan_2.1_vae.safetensors' })
      // the temporal rope stretched x7: five frames travel as far as a long clip would
      const model = b.ScaleROPE({
         model: b.ModelSamplingSD3({
            model: b.UNETLoader({ unet_name: 'chrono_edit_14B_fp16.safetensors', weight_dtype: 'fp8_e4m3fn' }),
            shift: 5,
         }),
         scale_x: 1,
         shift_x: 0,
         scale_y: 1,
         shift_y: 0,
         scale_t: 7,
         shift_t: 0,
      })

      // the input image is the first frame, also seen by clip vision
      const video = b.WanImageToVideo({
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         vae,
         clip_vision_output: b.CLIPVisionEncode({
            clip_vision: b.CLIPVisionLoader({ clip_name: 'clip_vision_h.safetensors' }),
            image: loaded,
            crop: 'none',
         }),
         start_image: loaded,
         width: 720,
         height: 720,
         length: 5,
         batch_size: 1,
      })
      const samples = b.KSampler({
         model,
         positive: video.outputs.positive,
         negative: video.outputs.negative,
         latent_image: video.outputs.latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'uni_pc',
         scheduler: 'simple',
         denoise: 1,
      })
      // frame 4 of 0..4: the finished edit
      b.SaveImageWebsocket({
         images: b.ImageFromBatch({ image: b.VAEDecode({ samples, vae }), batch_index: 4, length: 1 }),
      })
   },
})

export default chronoeditI2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) chronoeditI2i.vars.image.set(process.argv[2])
   if (process.argv[3]) chronoeditI2i.vars.prompt.set(process.argv[3])
   if (process.argv[4]) chronoeditI2i.vars.seed.set(Number(process.argv[4]))
   const execution = await chronoeditI2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/chronoedit-i2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
