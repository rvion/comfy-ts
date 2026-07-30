// chatterbox t2a on Comfy Cloud — Chatterbox Multilingual TTS: text to speech in 23 languages, mp3 out
// source template: audio-chatterbox_tts_multilingual.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/chatterbox-t2a.cflow.ts ["text"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const chatterboxT2a = host.defineWorkflow({
   id: 'chatterbox-t2a',
   vars: {
      // ONE prompt var: the text to speak (`//` lines are comments)
      prompt: v.prompt(
         'Hola amigos, bienvenidos de nuevo a ComfyUI.\nHoy vamos a explorar Chatterbox, síntesis de voz multilingüe en Comfy Cloud.',
      ),
      seed: v.seed(42),
      language: v.choice(
         [
            'Arabic (ar)',
            'Chinese (zh)',
            'Danish (da)',
            'Dutch (nl)',
            'English (en)',
            'Finnish (fi)',
            'French (fr)',
            'German (de)',
            'Greek (el)',
            'Hebrew (he)',
            'Hindi (hi)',
            'Italian (it)',
            'Japanese (ja)',
            'Korean (ko)',
            'Malay (ms)',
            'Norwegian (no)',
            'Polish (pl)',
            'Portuguese (pt)',
            'Russian (ru)',
            'Spanish (es)',
            'Swahili (sw)',
            'Swedish (sv)',
            'Turkish (tr)',
         ],
         'Spanish (es)',
      ),
      exaggeration: v.float(0.5, { min: 0, max: 2 }),
      cfgWeight: v.float(0.5, { min: 0, max: 1 }),
      temperature: v.float(0.8, { min: 0.05, max: 2 }),
   },
   build: (b, vars) => {
      const speech = b['Fill-ChatterBox.FL_ChatterboxMultilingualTTS']({
         text: vars.prompt.positive,
         language: vars.language,
         exaggeration: vars.exaggeration,
         cfg_weight: vars.cfgWeight,
         temperature: vars.temperature,
         repetition_penalty: 2,
         min_p: 0.05,
         top_p: 1,
         seed: vars.seed,
         use_cpu: false,
         keep_model_loaded: false,
      })
      b.SaveAudioMP3({ audio: speech, filename_prefix: 'comfy-ts-zoo/chatterbox-t2a', quality: 'V0' })
   },
})

export default chatterboxT2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) chatterboxT2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) chatterboxT2a.vars.seed.set(Number(process.argv[3]))
   const execution = await chatterboxT2a.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
