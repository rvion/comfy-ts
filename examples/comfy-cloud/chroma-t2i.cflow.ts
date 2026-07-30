// chroma t2i on Comfy Cloud — Chroma1-HD (fp8, T5-XXL text encoder), real cfg with a negative prompt
// source template: image_chroma_text_to_image.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/chroma-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const chromaT2i = host.defineWorkflow({
   id: 'chroma-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'nature documentary close-up photograph of a tiger face, highly detailed speckled eye, intricate fur, natural light, subtle shadows, unfiltered amateur photography\n- low quality blurred sketch, chromatic aberrations, oversaturated, toony flat colors',
      ),
      seed: v.seed(42),
      steps: v.int(26, { min: 1, max: 50 }),
      cfg: v.float(3.5, { min: 0, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const model = b.ModelSamplingAuraFlow({
         model: b.UNETLoader({ unet_name: 'Chroma1-HD-fp8mixed.safetensors', weight_dtype: 'default' }),
         shift: 1,
      })
      // chroma rides a padding-free T5 tokenizer, per the template
      const clip = b.T5TokenizerOptions({
         clip: b.CLIPLoader({ clip_name: 't5xxl_fp8_e4m3fn_scaled.safetensors', type: 'chroma', device: 'default' }),
         min_padding: 0,
         min_length: 0,
      })
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'beta',
         denoise: 1,
      })
      b.SaveImage({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'ae.safetensors' }) }),
         filename_prefix: 'comfy-ts-zoo/chroma-t2i',
      })
   },
})

export default chromaT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) chromaT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) chromaT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await chromaT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
