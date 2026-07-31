// newbie t2i on Comfy Cloud — NewBie-Image Exp0.1 anime model (AuraFlow-style UNET, gemma3+jina dual CLIP)
// source template: image_newbieimage_exp0_1-t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/newbie-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// NewBie is instruction-tuned: both branches open with a fixed system prompt (from the template)
const POSITIVE_SYSTEM =
   'You are an assistant designed to generate high-quality anime images with the highest degree of image-text alignment based on xml format textual prompts. <Prompt Start>\n'
const NEGATIVE_SYSTEM =
   'You are an assistant designed to generate low-quality images based on textual prompts. <Prompt Start>\n'

export const newbieT2i = host.defineWorkflow({
   id: 'newbie-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'masterpiece, best quality, newest, absurdres, 1girl, blue hair, long hair, ahoge, blue eyes, black witch hat, white and blue dress, pointing at viewer, swirling cerulean water vortex, glowing crystal petals, dramatic lighting, dutch angle, anime style illustration',
      ),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      cfg: v.float(5.5, { min: 0, max: 30 }),
      size: v.size({ width: 1024, height: 1536 }),
   },
   build: (b, vars) => {
      const clip = b.DualCLIPLoader({
         clip_name1: 'gemma_3_4b_it_bf16.safetensors',
         clip_name2: 'jina_clip_v2_bf16.safetensors',
         type: 'newbie',
         device: 'default',
      })
      const samples = b.KSampler({
         model: b.ModelSamplingAuraFlow({
            model: b.UNETLoader({ unet_name: 'NewBie-Image-Exp0.1-bf16.safetensors', weight_dtype: 'default' }),
            shift: 6,
         }),
         positive: b.CLIPTextEncode({ clip, text: POSITIVE_SYSTEM + vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: NEGATIVE_SYSTEM + vars.prompt.negative }),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'res_multistep',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'ae.safetensors' }) }) })
   },
})

export default newbieT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) newbieT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) newbieT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await newbieT2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/newbie-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
