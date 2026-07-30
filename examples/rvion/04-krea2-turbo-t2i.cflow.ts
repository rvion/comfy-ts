// krea2 turbo text-to-image, ported from a real production pipeline
// (rabbits-vs-sheeps "unified"). krea2 turbo UNET + standard LoraLoader chain
// → KSampler(8 steps, cfg 1) → RMBG cutout → transparent png game sprite.
//
// run directly:  bun examples/rvion/04-krea2-turbo-t2i.cflow.ts ["prompt"] [seed]
// in the TUI:    bun src/cli/comfy-ts-cli.ts tui examples/rvion/04-krea2-turbo-t2i.cflow.ts
// tui browser:   bun src/cli/comfy-ts-cli.ts tui examples/   (scans **/*.cflow.ts)
import { activeLoras, ComfyTS } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import (lora options come from the cached schema); run() connects lazily

export const t2i = host.defineWorkflow({
   id: 'krea2-turbo-t2i',
   // vars as a LAMBDA: it RECEIVES the host-typed `v` (no import), and
   // cross-referencing vars (loras + the prompt that prefixes their
   // keywords) live in one scope, resolved once at define time
   vars: (v) => {
      // multi-select lora stack, DYNAMIC: the regex resolves against the
      // host's loras at define time, fully typed (E_LoraName union) —
      // nothing selected by default, tick/untick + strengths in the TUI
      const loras = v.loras(/krea-?2/i)
      return {
         // v.prompt: `//` lines are comments, `- ` lines are NEGATIVE prompt
         // lines (both stripped from .positive; negatives land in .negative),
         // and the ACTIVE loras' keywords prefix .positive (assigned via ⌃K
         // in the TUI loras overlay, stored in .comfy-ts/lora-keywords.json)
         prompt: v.prompt('top-down, game sprite, spherical sheep', { loraKeywordsFrom: loras }),
         seed: v.seed(517),
         steps: v.int(8, { min: 1, max: 40 }),
         size: v.size({ width: 1024, height: 1024 }),
         removeBg: v.toggle(true, 'remove bg'),
         loras,
         prefix: v.text('krea2-turbo-t2i'),
      }
   },
   build: (b, vars) => {
      // models
      const unet = b.UNETLoader({ unet_name: 'krea2_turbo_fp8_scaled.safetensors', weight_dtype: 'default' })
      const clipLoader = b.CLIPLoader({
         clip_name: 'qwen3vl_4b_fp8_scaled.safetensors',
         type: 'krea2',
         device: 'default',
      })
      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })

      // standard LoraLoader chain: one node per active lora, model+clip rethreaded
      let model = unet._MODEL
      let clip = clipLoader._CLIP
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

      // prompt → conditioning. `- ` prompt lines arrive in .negative; when
      // there are none, zeroed-out conditioning stays the turbo default
      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: positive })
            : b.CLIPTextEncode({ clip, text: vars.prompt.negative })

      // size → latent (core node, dims straight from the size var)
      const latent = b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 })

      // sample + decode
      const samples = b.KSampler({
         model,
         positive,
         negative,
         latent_image: latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      const image = b.VAEDecode({ samples, vae })

      if (vars.removeBg) {
         // background removal → transparent png. SaveImage alone drops RMBG's
         // alpha, so rejoin the MASK via core JoinImageWithAlpha (which inverts
         // the mask internally — hence the InvertMask in front).
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
         b.SaveImage({ images: rgba, filename_prefix: vars.prefix })
      } else {
         b.SaveImage({ images: image, filename_prefix: vars.prefix })
      }
   },
})

export default t2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) t2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) t2i.vars.seed.set(Number(process.argv[3]))

   const execution = await t2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
