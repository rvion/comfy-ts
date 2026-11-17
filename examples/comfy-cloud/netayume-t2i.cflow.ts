// netayume t2i on Comfy Cloud — NetaYume Lumina 3.5, an anime fine-tune of Lumina-Image-2.0 (all-in-one checkpoint), best at 1024x1024
// source template: image_netayume_lumina_t2i.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/netayume-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// the gemma encoder reads a system prompt first: both prefixes stay fixed up to the <Prompt Start> tag
const POSITIVE_PREFIX =
   'You are an assistant designed to generate high quality anime images based on textual prompts. <Prompt Start> '
const NEGATIVE_PREFIX =
   'You are an assistant designed to generate low-quality images based on textual prompts <Prompt Start> '

export const netayumeT2i = host.defineWorkflow({
   id: 'netayume-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt; `@name` is an artist tag
      prompt: v.prompt(
         [
            'Warm and cheerful digital illustration of a girl standing in the middle of an orange grove, surrounded by lush green leaves and ripe, vibrant oranges hanging from the trees. She has chestnut-brown hair tied in a single loose braid falling over her shoulder, with soft bangs framing her bright, smiling face. She wears a crisp white blouse under a black jacket. Sunlight filters through the leaves, casting dappled golden light on her hair and shoulders. Painterly and soft art style.',
            '- blurry, worst quality, low quality, jpeg artifacts, signature, watermark, username, error, deformed hands, bad anatomy, extra limbs, poorly drawn hands, poorly drawn face, mutation, deformed, extra eyes, extra arms, extra legs, malformed limbs, fused fingers, too many fingers, long neck, cross-eyed, bad proportions, missing arms, missing legs, extra digit, fewer digits, cropped',
         ].join('\n'),
      ),
      seed: v.seed(42),
      steps: v.int(30, { min: 1, max: 80 }),
      cfg: v.float(4, { min: 1, max: 10 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'NetaYumev35_pretrained_all_in_one.safetensors' })
      const clip = ckpt.outputs.CLIP
      const samples = b.KSampler({
         model: b.ModelSamplingAuraFlow({ model: ckpt.outputs.MODEL, shift: 4 }),
         positive: b.CLIPTextEncode({ clip, text: POSITIVE_PREFIX + vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: NEGATIVE_PREFIX + vars.prompt.negative }),
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'res_multistep',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae: ckpt.outputs.VAE }) })
   },
})

export default netayumeT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) netayumeT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) netayumeT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await netayumeT2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/netayume-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
