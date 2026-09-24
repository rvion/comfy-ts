// anima text-to-image on the local box: anime UNET, qwen3 0.6b text encoder, qwen image vae.
// four models behind one choice, each with the settings its model card gives
// (huggingface.co/circlestone-labs/Anima): the distilled ones run 8 steps at cfg 1, the
// others 30-50 steps at cfg 4-5. er_sde is the author's default sampler, euler suits turbo.
//
// run directly:  bun examples/rvion/10-anima-t2i.cflow.ts ["prompt"] [seed]
import { activeLoras, ComfyTS } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache()

const TURBO_LORA = 'anima\\anima-turbo-lora-v0.2.safetensors'
// the a1111 tagcomplete list: fetched by serve on first use, never part of this repo
const DANBOORU_TAGS = 'https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/main/tags/danbooru.csv'

const MODELS = {
   // distilled: fast, stable, a strong default style. What the author suggests starting with
   turbo: { unet: 'anima-turbo-v1.1.safetensors', turboLora: false, distilled: true, scores: true },
   // base fine-tuned on high quality images only. Its card: no score_* tags, they push it into slop
   aesthetic: { unet: 'anima-aesthetic-v1.1.safetensors', turboLora: false, distilled: false, scores: false },
   // the raw pretrained model: plain neutral style, what loras are trained on
   base: { unet: 'anima-base-v1.0.safetensors', turboLora: false, distilled: false, scores: true },
   // base with the official turbo lora, the template's fast path
   'base+turbo': { unet: 'anima-base-v1.0.safetensors', turboLora: true, distilled: true, scores: true },
} as const

/** the tags in front of the prompt and the negative, from the top choices. Joined to the text
 * with ', ', and an empty side adds nothing, so a bare prompt reads exactly as typed */
const QUALITY_TAGS: Record<string, string[]> = {
   good: ['good quality'],
   best: ['best quality'],
   masterpiece: ['masterpiece', 'best quality'],
}

export function animaTags(p: {
   /** null = no quality tags (the lit button clicked off) */
   quality: string | null
   /** every score picked becomes its own tag; none picked = no score tag */
   score: readonly string[]
   /** null = no rating tag */
   safety: string | null
   /** false on aesthetic: its card says score tags push it into slop */
   scores: boolean
}): { positive: string[]; negative: string[] } {
   const score = p.scores ? p.score.map((n) => `score_${n}`) : []
   const quality = p.quality == null ? [] : (QUALITY_TAGS[p.quality] ?? [])
   return {
      positive: [...quality, ...score, ...(p.safety == null ? [] : [p.safety])],
      negative: [
         ...(quality.length > 0 ? ['worst quality', 'low quality'] : []),
         ...(score.length > 0 ? ['score_1', 'score_2', 'score_3'] : []),
      ],
   }
}

const joinTags = (tags: string[], text: string): string => [...tags, text].filter((t) => t.trim() !== '').join(', ')

/** the texts the two CLIPTextEncode nodes receive. ONE function for the build and the live
 * preview, so the preview is exactly what runs */
function animaPrompts(p: {
   model: keyof typeof MODELS
   quality: string | null
   score: readonly string[]
   safety: string | null
   prompt: { positive: string; negative: string }
}): { positive: string; negative: string } {
   const tags = animaTags({ quality: p.quality, score: p.score, safety: p.safety, scores: MODELS[p.model].scores })
   return { positive: joinTags(tags.positive, p.prompt.positive), negative: joinTags(tags.negative, p.prompt.negative) }
}

export const animaT2i = host.defineWorkflow({
   id: 'anima-t2i',
   vars: (v) => {
      // every lora inside an `anima/` folder (never WanAnimate and friends), except the turbo one: the model choice owns it
      const loras = v.loras(/^(?!.*anima-turbo-lora)(?:.*[\\/])?anima[\\/]/i)
      return {
         // the tags every anima prompt starts with, as buttons: the model card's order is
         // quality, score, safety, then the rest, and the build writes them in that order
         safety: v
            .choice(['safe', 'sensitive', 'nsfw', 'explicit'], 'safe', { label: 'safety', select: 'zero-or-one' })
            .ui({
               group: 'tags',
               groupColor: 'rgba(158, 206, 106, 0.07)',
               description: 'the rating tag anima was trained with, written after quality and score',
               // one color per rating, green to red, so the lit one says how far it goes
               options: {
                  safe: { color: '#9ece6a' },
                  sensitive: { color: '#e0af68' },
                  nsfw: { color: '#ff9e64' },
                  explicit: { color: '#f7768e' },
               },
            }),
         // any number of scores, each its own score_N tag in front, score_1..3 in the negative
         // once one is picked. Left out on aesthetic, as its card says
         score: v.choice(['6', '7', '8', '9'], ['7'], { label: 'score', select: 'many' }).ui({
            group: 'tags',
            description:
               'click to toggle: every score picked adds its score_N tag, and score_1 to 3 go to the negative. None picked, no score. Left out on aesthetic: its card says score tags push it into slop',
         }),
         // the card's human quality scale: masterpiece, best quality, good quality, … worst quality
         quality: v
            .choice(['good', 'best', 'masterpiece'], 'masterpiece', { label: 'quality', select: 'zero-or-one' })
            .ui({
               group: 'tags',
               description:
                  'good: good quality. best: best quality. masterpiece: masterpiece, best quality. Any of them puts worst quality, low quality in the negative',
            }),
         // anima reads booru tags and short phrases. `- ` lines are the negative prompt
         prompt: v.prompt(
            '1girl, silver hair, long coat, standing on a rooftop at dusk, city lights, wind, looking at viewer\n- blurry, jpeg artifacts, sepia',
            {
               loraKeywordsFrom: loras,
               // danbooru tag completion. The card: lowercase, spaces for underscores, artists as `@name`
               tags: { url: DANBOORU_TAGS, artistPrefix: '@' },
               // named starting texts: picking one REPLACES the box, the draft reverts it
               presets: {
                  'rooftop portrait':
                     '1girl, silver hair, long coat, standing on a rooftop at dusk, city lights, wind, looking at viewer\n- blurry, jpeg artifacts, sepia',
                  'chibi sprite':
                     'chibi, full body, simple background, white background, round sheep mascot, big eyes, flat colors\n- blurry, text, watermark',
                  landscape:
                     'no humans, scenery, floating islands, waterfalls, soft clouds, golden hour, detailed background\n- blurry, jpeg artifacts',
               },
            },
         ),
         // right under the prompt: the loras and the words they add are read together
         loras,
         seed: v.seed(1, { mode: '+' }),
         model: v.choice(['turbo', 'aesthetic', 'base', 'base+turbo'], 'turbo', 'model').ui({
            group: 'sampling',
            groupColor: 'rgba(122, 162, 247, 0.08)',
            description: 'turbo and base+turbo: 8 steps at cfg 1. aesthetic and base: the steps and cfg below',
         }),
         // auto = er_sde on aesthetic and base, euler on the distilled ones
         sampler: v.choice(['auto', 'er_sde', 'euler', 'euler_ancestral'], 'auto', 'sampler').ui({ group: 'sampling' }),
         // the distilled models ignore these: 8 steps at cfg 1 is what they were distilled for
         steps: v.int(30, { min: 1, max: 60 }).ui({
            group: 'sampling',
            description: 'only aesthetic and base read it: the distilled models run 8',
            activeWhen: { model: ['aesthetic', 'base'] },
         }),
         cfg: v.float(4, { min: 0, max: 15 }).ui({
            group: 'sampling',
            description: 'only aesthetic and base read it: the distilled models run at 1. The card suggests 4 to 5',
            activeWhen: { model: ['aesthetic', 'base'] },
         }),
         size: v.size({ width: 1024, height: 1024 }),
         removeBg: v.toggle(false, 'remove bg'),
      }
   },
   // the final prompt, live under generate while you edit: the tags, the lora keywords, your text
   previews: {
      prompt: (vars) => {
         const p = animaPrompts(vars)
         // written like the prompt box: the negative is a `- ` line, never part of the positive
         return p.negative === '' ? p.positive : `${p.positive}\n- ${p.negative}`
      },
   },
   build: (b, vars) => {
      const clipLoader = b.CLIPLoader({
         clip_name: 'qwen_3_06b_base.safetensors',
         type: 'stable_diffusion',
         device: 'default',
      })
      const spec = MODELS[vars.model]
      let model = b.UNETLoader({ unet_name: spec.unet, weight_dtype: 'default' })._MODEL
      let clip = clipLoader._CLIP
      if (spec.turboLora) model = b.LoraLoaderModelOnly({ model, lora_name: TURBO_LORA, strength_model: 1 })._MODEL
      for (const l of activeLoras(vars.loras)) {
         const loaded = b.LoraLoader({
            model,
            clip,
            lora_name: l.lora_name,
            strength_model: l.strength_model,
            strength_clip: l.strength_clip,
         })
         model = loaded._MODEL
         clip = loaded._CLIP
      }
      const prompts = animaPrompts(vars)
      const samples = b.KSampler({
         model,
         positive: b.CLIPTextEncode({ clip, text: prompts.positive }),
         negative: b.CLIPTextEncode({ clip, text: prompts.negative }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: spec.distilled ? 8 : vars.steps,
         cfg: spec.distilled ? 1 : vars.cfg,
         sampler_name: vars.sampler === 'auto' ? (spec.distilled ? 'euler' : 'er_sde') : vars.sampler,
         scheduler: 'simple',
         denoise: 1,
      })
      const image = b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' }) })
      if (vars.removeBg) {
         // same cutout as 04: the savers drop RMBG's alpha unless the mask is rejoined, and
         // JoinImageWithAlpha inverts the mask it gets, hence the InvertMask in front
         const cutout = b['rmbg.RMBG']({
            image,
            model: 'BEN2',
            sensitivity: 1,
            process_res: 1024,
            mask_blur: 0,
            mask_offset: 0,
            invert_output: false,
            refine_foreground: false,
            background: 'Alpha',
         })
         const rgba = b.JoinImageWithAlpha({
            image: cutout.outputs.IMAGE,
            alpha: b.InvertMask({ mask: cutout.outputs.MASK }),
         })
         b.SaveImageWebsocket({ images: rgba })
      } else {
         b.SaveImageWebsocket({ images: image })
      }
   },
})

export default animaT2i

// standalone run (skipped when another driver, the TUI or serve, imports this module)
if (import.meta.main) {
   if (process.argv[2]) animaT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) animaT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await animaT2i.run({ log: true, save: { prefix: 'comfy-ts-example/anima-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
