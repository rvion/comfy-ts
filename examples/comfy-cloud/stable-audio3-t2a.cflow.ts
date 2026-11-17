// stable-audio3 t2a on Comfy Cloud — Stable Audio 3 Medium, 8-step distilled text to audio: music, instruments, sound effects or one-shots
// source template: audio_stable_audio_3_medium.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: audio outputs PERSIST on the host (upstream ships no websocket saver for audio — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/stable-audio3-t2a.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
// the template's four per-category system prompts, verbatim, shared with rvion 12 (the same model on the local box)
import { SA3_CATEGORIES, sa3Reprompt } from '../rvion/stableAudio3Prompts.ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const stableAudio3T2a = host.defineWorkflow({
   id: 'stable-audio3-t2a',
   vars: {
      // ONE prompt var: a plain description is enough when `reprompt` is on (`//` lines are comments)
      prompt: v.prompt(
         'Tropical house track with marimba, steel drums, soft synths, smooth bass, layered percussion, and light piano riffs for sunny chill dance vibes',
      ),
      seed: v.seed(42),
      category: v.choice(SA3_CATEGORIES, 'Music', 'category'),
      // on: a qwen3.5 2b first rewrites the description with the category's system prompt and the target length
      reprompt: v.toggle(true, 'reprompt'),
      seconds: v.float(150, { min: 1, max: 300 }),
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
              prompt: sa3Reprompt({
                 category: vars.category,
                 input: vars.prompt.positive,
                 seconds: Math.floor(vars.seconds),
              }),
              max_length: 256,
              sampling_mode: 'on',
              'sampling_mode.temperature': 0.7,
              'sampling_mode.top_k': 64,
              'sampling_mode.top_p': 0.95,
              'sampling_mode.min_p': 0.05,
              'sampling_mode.repetition_penalty': 1.05,
              'sampling_mode.seed': 0,
              thinking: false,
              use_default_template: true,
              mtp: 'auto',
           }).outputs.generated_text
         : vars.prompt.positive

      // distilled: 8 lcm steps at cfg 1, an empty negative
      const samples = b.KSampler({
         model: ckpt.outputs.MODEL,
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
      b.SaveAudioAdvanced({
         audio: b.VAEDecodeAudio({ samples, vae: ckpt.outputs.VAE }),
         filename_prefix: 'comfy-ts-zoo/stable-audio3-t2a',
         format: 'mp3',
         'format.quality': 'V0',
      })
   },
})

export default stableAudio3T2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) stableAudio3T2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) stableAudio3T2a.vars.seed.set(Number(process.argv[3]))
   const execution = await stableAudio3T2a.run({ log: true, save: { prefix: 'comfy-ts-zoo/stable-audio3-t2a' } })
   for (const audio of execution.audios) console.log(`🟢 ${audio.absPath}`)
   host.disconnect()
}
