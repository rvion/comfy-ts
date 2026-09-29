// a new voice from a written description, on windows-1: Qwen3-TTS VoiceDesign speaks one sample
// line in the voice you describe. The clip and that line are the pair 15-tts-voice-clone takes
// as `voice` and `transcript`, so every later line keeps the same voice. The line comes back
// as a text output too: `comfy-ts run` writes it beside the clip as its transcript
// box inventory: custom node pack TTS-Audio-Suite (github.com/diodiogod/TTS-Audio-Suite); the
// VoiceDesign checkpoint downloads on first use, which takes minutes
// run directly:  bun examples/rvion/16-tts-voice-design.cflow.ts ["description"] ["line"]
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

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

export const ttsVoiceDesign = host.defineWorkflow({
   id: 'tts-voice-design',
   tags: ['tts', 'voice'],
   vars: {
      description: v.text('An old sailor, gravelly and warm, slow pace, a smile in the voice.', {
         label: 'the voice: age, gender, pitch, texture, accent, pace, mood',
      }),
      line: v.text('Ahoy, and welcome aboard. The sea is calm tonight, so sit down and listen to my story.', {
         label: 'what the sample says (8 to 12 s of speech clones best)',
      }),
      language: v.choice(LANGUAGES, 'English', 'language'),
      seed: v.seed(7),
   },
   build: (b, vars) => {
      const S = 'TTS-Audio-Suite'
      const engine = b[`${S}.Qwen3TTSEngineNode`]({
         model_variant: 'Voice Design - 1.7B VoiceDesign',
         device: 'auto',
         voice_preset: 'None (Zero-shot / Custom)',
         language: vars.language,
         instruct: '',
      })
      const designed = b[`${S}.UnifiedVoiceDesignerNode`]({
         TTS_engine: engine.outputs.TTS_engine,
         reference_text: vars.line,
         voice_instruction: vars.description,
         seed: vars.seed,
      })
      b.PreviewAudio({ audio: designed.outputs.preview_audio })
      // the transcript of the clip: the line itself, as a text output
      b.PreviewAny({ source: vars.line })
   },
})

export default ttsVoiceDesign

// standalone run (skipped when another driver, like the TUI, imports this module)
if (import.meta.main) {
   if (process.argv[2]) ttsVoiceDesign.vars.description.set(process.argv[2])
   if (process.argv[3]) ttsVoiceDesign.vars.line.set(process.argv[3])

   const execution = await ttsVoiceDesign.run({ log: true, save: { prefix: 'comfy-ts-example/tts-voice-design' } })
   for (const clip of execution.audios) console.log(`🟢 ${clip.absPath}`)
   host.disconnect()
}
