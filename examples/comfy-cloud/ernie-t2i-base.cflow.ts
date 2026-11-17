// ernie t2i base on Comfy Cloud — ERNIE Image (Baidu), the undistilled model: 20 steps at cfg 4, with its own prompt enhancer (flux2 vae)
// source template: image_ernie_image.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/ernie-t2i-base.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// the enhancer's chat turn, verbatim from the template: the short description and the target size go in, a rich description comes out
const ENHANCER_TURN =
   '<s>[SYSTEM_PROMPT]你是一个专业的文生图 Prompt 增强助手。你将收到用户的简短图片描述及目标生成分辨率，请据此扩写为一段内容丰富、细节充分的视觉描述，以帮助文生图模型生成高质量的图片。仅输出增强后的描述，不要包含任何解释或前缀。[/SYSTEM_PROMPT][INST]{"prompt": "{prompt}", "width": {width}, "height": {height}}[/INST]'

export const ernieT2iBase = host.defineWorkflow({
   id: 'ernie-t2i-base',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'High-fashion summer outfit infographic: a straw hat, a sleeveless organic cotton top, a flowing pleated skirt, handcrafted leather sandals and a woven palm leaf handbag float in an elegant circular composition, with fine annotations on fabric and comfort. Warm neutral palette of ivory, terracotta, sand and soft tan, gentle fabric swirls, bright natural sunlight, Mediterranean style.',
      ),
      seed: v.seed(42),
      // on: ERNIE's prompt enhancer model first expands the description for the target size
      enhance: v.toggle(true, 'enhance prompt'),
      steps: v.int(20, { min: 1, max: 80 }),
      cfg: v.float(4, { min: 1, max: 10 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const clip = b.CLIPLoader({ clip_name: 'ministral-3-3b.safetensors', type: 'flux2', device: 'default' })
      const text = vars.enhance
         ? b.TextGenerate({
              clip: b.CLIPLoader({
                 clip_name: 'ernie-image-prompt-enhancer.safetensors',
                 type: 'flux2',
                 device: 'default',
              }),
              prompt: ENHANCER_TURN.replace('{prompt}', vars.prompt.positive)
                 .replace('{width}', String(vars.size.width))
                 .replace('{height}', String(vars.size.height)),
              max_length: 2048,
              sampling_mode: 'on',
              'sampling_mode.temperature': 0.6,
              'sampling_mode.top_k': 64,
              'sampling_mode.top_p': 0.8,
              'sampling_mode.min_p': 0.05,
              'sampling_mode.repetition_penalty': 1.05,
              'sampling_mode.seed': 0,
              thinking: false,
              use_default_template: true,
              mtp: 'auto',
           }).outputs.generated_text
         : vars.prompt.positive
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'ernie-image.safetensors', weight_dtype: 'default' }),
         positive: b.CLIPTextEncode({ clip, text }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptyFlux2LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({
         images: b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'flux2-vae.safetensors' }) }),
      })
   },
})

export default ernieT2iBase

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) ernieT2iBase.vars.prompt.set(process.argv[2])
   if (process.argv[3]) ernieT2iBase.vars.seed.set(Number(process.argv[3]))
   const execution = await ernieT2iBase.run({ log: true, save: { prefix: 'comfy-ts-zoo/ernie-t2i-base' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
