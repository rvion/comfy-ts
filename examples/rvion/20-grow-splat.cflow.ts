// fill the holes of a splat seen from a new camera: the one ComfyUI step of the grow loop (grow-splat/grow.ts).
// The input is the render as a png whose alpha is how much of each pixel the splat covers; LoadImage turns that
// alpha into the mask (1 = empty). Qwen-Image-Edit-2509 repaints only the empty part (a latent noise mask), with
// the whole render as its reference, so the new part keeps the style, the light and the perspective of the rest.
// The covered pixels come back untouched (composited over the result).
//
// run directly:  bun examples/rvion/20-grow-splat.cflow.ts [path/to/render-rgba.png] [seed]
import { ComfyTS, exampleImagePath, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1' })
await host.loadSchemaFromCache()

/** what the model is told; a world's own words (what lies beyond) go after it */
export const FILL_PROMPT =
   'Fill the empty black areas so the scene continues seamlessly beyond its edges and behind its objects: the same place, the same architecture, materials, lighting, colours and painting style, the same camera perspective. Keep everything that is already visible unchanged.'

const render = v.image(exampleImagePath('walrus_1344x768.jpg'))

export const growSplatFill = host.defineWorkflow({
   id: 'grow-splat-fill',
   vars: {
      render,
      prompt: v.prompt(FILL_PROMPT),
      /** a pixel covered less than this counts as empty */
      covered: v.float(0.9, { min: 0.05, max: 1 }),
      /** pixels added around the empty part, so the seam is painted again too */
      grow: v.int(12, { min: 0, max: 128 }),
      seed: v.seed(42),
      steps: v.int(20, { min: 4, max: 60 }),
      cfg: v.float(4, { min: 1, max: 10 }),
   },
   build: async (b, vars, wf) => {
      const loaded = await render.loadInWorkflow(wf)
      const hole = b.GrowMask({
         mask: b.ThresholdMask({ mask: loaded.outputs.MASK, value: 1 - vars.covered }),
         expand: vars.grow,
         tapered_corners: true,
      })
      // the model never sees black: the hole starts as a smooth continuation of its border
      const prefilled = b['inpaint-nodes.INPAINT_MaskedFill']({ image: loaded.outputs.IMAGE, mask: hole, fill: 'telea', falloff: 0 })
      const clip = b.CLIPLoader({ clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image' })
      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })
      const unet = b.UNETLoader({ unet_name: 'qwen_image_edit_2509_int8_convrot.safetensors', weight_dtype: 'default' })
      const encode = (prompt: string) => b.TextEncodeQwenImageEditPlus({ clip, prompt, vae, image1: prefilled })
      const samples = b.KSampler({
         model: b.ModelSamplingAuraFlow({ model: unet, shift: 3.1 }),
         positive: encode(vars.prompt.positive),
         negative: encode(vars.prompt.negative),
         latent_image: b.SetLatentNoiseMask({ samples: b.VAEEncode({ pixels: prefilled, vae }), mask: hole }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      // a soft edge, so the seam between the kept pixels and the painted ones does not show
      const soft = b['kjnodes.GrowMaskWithBlur']({
         mask: hole,
         expand: 0,
         incremental_expandrate: 0,
         tapered_corners: true,
         flip_input: false,
         blur_radius: 6,
         lerp_alpha: 1,
         decay_factor: 1,
      })
      const filled = b.ImageCompositeMasked({
         destination: loaded.outputs.IMAGE,
         source: b.VAEDecode({ samples, vae }),
         x: 0,
         y: 0,
         mask: soft.outputs.mask,
      })
      b.SaveImageWebsocket({ images: filled }, { tag: 'filled' })
   },
})

export default growSplatFill

if (import.meta.main) {
   if (process.argv[2]) growSplatFill.vars.render.set(process.argv[2])
   if (process.argv[3]) growSplatFill.vars.seed.set(Number(process.argv[3]))
   const execution = await growSplatFill.run({ log: true, save: { prefix: 'comfy-ts-example/grow-splat-fill' } })
   for (const img of execution.images) console.log(`🟢 ${img.tags.join(',')} ${img.absPath}`)
   host.disconnect()
}
