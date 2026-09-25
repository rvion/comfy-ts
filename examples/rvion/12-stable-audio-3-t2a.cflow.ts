// stable audio 3 medium text-to-audio on windows-1 — mirrors the official audio_stable_audio_3_medium template
// instrumental music, instruments, sound effects or one-shots from one description. With `reprompt` on, a
// local qwen3.5 2b first rewrites the text with the template's system prompt for the category (shown as a text output)
// box inventory: stable_audio_3_medium (checkpoints/), t5gemma_b_b_ul2 + qwen3.5_2b_bf16 (text_encoders/), ComfyUI ≥ 0.37
// PreviewAudio writes into the host's temp/ folder only (wiped at every ComfyUI boot)
// run directly:  bun examples/rvion/12-stable-audio-3-t2a.cflow.ts ["prompt"] [seed]
import { ComfyTS, v } from 'comfy-ts'
import { SA3_CATEGORIES, sa3Reprompt } from './stableAudio3Prompts.ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

export const stableAudio3T2a = host.defineWorkflow({
   id: 'stable-audio-3-t2a',
   vars: {
      prompt: v.prompt(
         'Tropical house track with marimba, steel drums, soft synths, smooth bass, layered percussion, and light piano riffs for sunny chill dance vibes',
      ),
      seed: v.seed(42, { mode: '+' }),
      category: v.choice(SA3_CATEGORIES, 'Music', 'category'),
      reprompt: v.toggle(true, 'reprompt'),
      seconds: v.float(60, { min: 1, max: 300, label: 'length (s)' }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'stable_audio_3_medium.safetensors' })
      const clip = b.CLIPLoader({ clip_name: 't5gemma_b_b_ul2.safetensors', type: 'stable_audio', device: 'default' })

      const text = vars.reprompt
         ? b.TextGenerate({
              clip: b.CLIPLoader({
                 clip_name: 'qwen3.5_2b_bf16.safetensors',
                 type: 'stable_diffusion',
                 device: 'default',
              }),
              prompt: sa3Reprompt({ category: vars.category, input: vars.prompt.positive, seconds: vars.seconds }),
              max_length: 256,
              thinking: false,
              sampling_mode: 'on',
              'sampling_mode.temperature': 0.7,
              'sampling_mode.top_k': 64,
              'sampling_mode.top_p': 0.95,
              'sampling_mode.min_p': 0.05,
              'sampling_mode.repetition_penalty': 1.05,
              'sampling_mode.seed': vars.seed,
           }).outputs.generated_text
         : vars.prompt.positive
      if (typeof text !== 'string') b.PreviewAny({ source: text })

      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip, text }),
         negative: b.CLIPTextEncode({ clip, text: '' }),
         latent_image: b.EmptyLatentAudio({ seconds: vars.seconds, batch_size: 1 }),
         seed: vars.seed,
         steps: 8,
         cfg: 1,
         sampler_name: 'lcm',
         scheduler: 'simple',
         denoise: 1,
      })
      b.PreviewAudio({ audio: b.VAEDecodeAudio({ samples, vae: ckpt }) })
   },
})

export default stableAudio3T2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) stableAudio3T2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) stableAudio3T2a.vars.seed.set(Number(process.argv[3]))

   const execution = await stableAudio3T2a.run({ log: true, save: { prefix: 'comfy-ts-example/stable-audio-3-t2a' } })
   if (execution.text != null) console.log(`📝 reprompted: ${execution.text}`)
   for (const audio of execution.audios) console.log(`🟢 ${audio.absPath}`)
   host.disconnect()
}
