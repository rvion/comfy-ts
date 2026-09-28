// text to speech in a cloned voice, on windows-1: one reference clip and its transcript become the
// voice, and the engine you pick reads your text with it, in the language you pick
// engines: chatterbox (Chatterbox Multilingual v3, 0.5B, fast), qwen3 (Qwen3-TTS 1.7B Base),
// fishs2 (Fish Audio S2 Pro, fp8), cosyvoice3 (Fun-CosyVoice3 0.5B), omnivoice (OmniVoice)
// box inventory: custom node pack TTS-Audio-Suite (github.com/diodiogod/TTS-Audio-Suite); every
// engine downloads its weights on first use, which takes minutes. The bundled voice is synthetic
// (examples/media/README.md); drop your own clip on `voice` and write what it says in `transcript`
// run directly:  bun examples/rvion/15-tts-voice-clone.cflow.ts ["text"] [engine] [language]
import { ComfyTS, exampleMediaPath, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

const ENGINES = ['chatterbox', 'qwen3', 'fishs2', 'cosyvoice3', 'omnivoice'] as const
// the languages every engine here names the same way
const LANGUAGES = [
   'English',
   'French',
   'German',
   'Spanish',
   'Italian',
   'Portuguese',
   'Russian',
   'Japanese',
   'Korean',
   'Chinese',
] as const

// bundled default (examples/media/, ships in the tarball)
const voice = v.audio(exampleMediaPath('voice_en_6s.flac'))

export const ttsVoiceClone = host.defineWorkflow({
   id: 'tts-voice-clone',
   tags: ['tts', 'voice'],
   vars: {
      prompt: v.prompt(
         'Welcome back, traveler. The road ahead is long, but the view from the top is worth every step.',
      ),
      seed: v.seed(1),
      engine: v.choice(ENGINES, 'chatterbox', 'engine'),
      language: v.choice(LANGUAGES, 'English', 'language'),
      voice,
      transcript: v.text(
         'This is a short sample of my voice. Clone it, and I can read any text you give me, in many languages.',
         {
            label: 'transcript of the voice clip',
         },
      ),
   },
   // async build: the voice clip is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const S = 'TTS-Audio-Suite'
      const engine = (() => {
         switch (vars.engine) {
            case 'chatterbox':
               return b[`${S}.ChatterBoxOfficial23LangEngineNode`]({
                  model_version: 'v3',
                  language: vars.language,
                  device: 'auto',
               })
            case 'qwen3':
               return b[`${S}.Qwen3TTSEngineNode`]({
                  model_variant: 'TTS - Base 1.7B (Voice Clone)',
                  device: 'auto',
                  voice_preset: 'None (Zero-shot / Custom)',
                  language: vars.language,
                  instruct: '',
               })
            case 'fishs2':
               return b[`${S}.FishAudioS2EngineNode`]({ model: 's2-pro-fp8', device: 'auto' })
            case 'cosyvoice3':
               return b[`${S}.CosyVoiceEngineNode`]({ model_path: 'Fun-CosyVoice3-0.5B-RL', device: 'auto' })
            case 'omnivoice':
               return b[`${S}.OmniVoiceEngineNode`]({
                  model_variant: 'OmniVoice',
                  device: 'auto',
                  language: vars.language,
               })
         }
      })()
      const narrator = b[`${S}.CharacterVoicesNode`]({
         voice_name: 'none',
         reference_text: vars.transcript,
         opt_audio_input: await voice.loadInWorkflow(wf),
      })
      const speech = b[`${S}.UnifiedTTSTextNode`]({
         TTS_engine: engine.outputs.TTS_engine,
         text: vars.prompt.positive,
         narrator_voice: 'none',
         opt_narrator: narrator.outputs.opt_narrator,
         seed: vars.seed,
         enable_chunking: false,
         enable_audio_cache: false,
      })
      b.PreviewAudio({ audio: speech.outputs.audio })
   },
})

export default ttsVoiceClone

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) ttsVoiceClone.vars.prompt.set(process.argv[2])
   if (process.argv[3]) ttsVoiceClone.vars.engine.set(process.argv[3] as (typeof ENGINES)[number])
   if (process.argv[4]) ttsVoiceClone.vars.language.set(process.argv[4] as (typeof LANGUAGES)[number])

   const execution = await ttsVoiceClone.run({ log: true, save: { prefix: 'comfy-ts-example/tts-voice-clone' } })
   for (const clip of execution.audios) console.log(`🟢 ${clip.absPath}`)
   host.disconnect()
}
