// yue2 text-to-music on windows-1 — mirrors the official audio_yue2_text2music template
// a full song with vocals from a style line and tagged lyrics. ABC planning first writes a symbolic
// plan (melody + chords, or melody only), then the music follows it. The plan shows as a text output
// box inventory: yue2_3b_int8_convrot (Comfy-Org/YuE2, checkpoints/), ComfyUI ≥ 0.37
// PreviewAudio writes into the host's temp/ folder only (wiped at every ComfyUI boot)
// run directly:  bun examples/rvion/11-yue2-t2a.cflow.ts ["prompt"] [seed]
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

export const yue2T2a = host.defineWorkflow({
   id: 'yue2-t2a',
   vars: {
      // FIRST line = the style (language, genre, vocal, tempo, instruments), remaining lines = the
      // lyrics with [Verse] [Chorus] [Bridge] [Outro] tags, only the words to be sung (`//` lines are comments)
      prompt: v.prompt(
         [
            'English, warm female vocal, upbeat indie pop, 118 BPM, bright electric guitars, punchy drums, melodic bass, subtle synth layers, summer atmosphere, polished modern production',
            '',
            '[Verse]',
            'Morning light across the window',
            'City waking down below',
            'I can hear the streets are calling',
            'Feels like somewhere we should go',
            '',
            '[Chorus]',
            'Run with me into the sunlight',
            'Leave the shadows far behind',
            "We don't need to know tomorrow",
            'Tonight the whole world feels alive',
            '',
            '[Verse]',
            'Radio playing through the open door',
            'Laughing like we did before',
            'Every mile becomes a memory',
            'And I just want a little more',
            '',
            '[Chorus]',
            'Run with me into the sunlight',
            'Leave the shadows far behind',
            "We don't need to know tomorrow",
            'Tonight the whole world feels alive',
         ].join('\n'),
      ),
      seed: v.seed(42, { mode: '+' }),
      // full = melody and chords, melody = melody only (freer accompaniment), off = no plan
      planning: v.choice(['full', 'melody', 'off'], 'full', 'abc planning'),
      // an upper bound: the song may end sooner, when its structure is done
      maxDuration: v.float(120, { min: 10, max: 360, label: 'max duration (s)' }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'yue2_3b_int8_convrot.safetensors' })
      const [styleLine, ...lyricLines] = vars.prompt.positive.split('\n')
      const style = styleLine ?? ''
      const lyrics = lyricLines.join('\n').trim()
      const mode = vars.planning === 'melody' ? 'melody' : 'full'

      // an empty abc makes the music node ignore `mode`, which is what "off" means
      const abc =
         vars.planning === 'off'
            ? ''
            : b.PreviewAny({
                 source: b.YuE2GenerateABC({ clip: ckpt, style, lyrics, seed: vars.seed, mode }).outputs.abc,
              })
      const music = b.YuE2GenerateMusic({
         clip: ckpt,
         style,
         lyrics,
         abc,
         seed: vars.seed,
         mode,
         max_duration: vars.maxDuration,
      })
      const samples = b.KSampler({
         model: ckpt,
         positive: music.outputs.CONDITIONING,
         negative: b.ConditioningZeroOut({ conditioning: music.outputs.CONDITIONING }),
         // the music node decides the real length, the latent follows it
         latent_image: b.EmptyYuE2LatentAudio({ seconds: music.outputs.seconds, batch_size: 1 }),
         seed: vars.seed,
         steps: 32,
         cfg: 1,
         sampler_name: 'dpm_2',
         scheduler: 'sgm_uniform',
         denoise: 1,
      })
      b.PreviewAudio({ audio: b.VAEDecodeAudio({ samples, vae: ckpt }) })
   },
})

export default yue2T2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) yue2T2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) yue2T2a.vars.seed.set(Number(process.argv[3]))

   const execution = await yue2T2a.run({ log: true, save: { prefix: 'comfy-ts-example/yue2-t2a' } })
   if (execution.text != null) console.log(`🎼 abc plan:\n${execution.text}`)
   for (const audio of execution.audios) console.log(`🟢 ${audio.absPath}`)
   host.disconnect()
}
