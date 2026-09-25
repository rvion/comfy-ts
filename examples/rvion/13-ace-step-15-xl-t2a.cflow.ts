// ace-step 1.5 xl text-to-music on windows-1 — mirrors the official audio_ace_step1_5_xl_{turbo,sft,base} templates
// a full song with vocals from a caption and tagged lyrics. Three models behind one choice, each with its
// template's sampling: turbo 8 steps at cfg 1, sft 50 at cfg 7, base 50 at cfg 6
// box inventory: acestep_v1.5_xl_{turbo,sft,base}_bf16 (diffusion_models/), ace_1.5_vae (vae/),
// qwen_0.6b_ace15 + qwen_4b_ace15 (text_encoders/), ComfyUI ≥ 0.37
// PreviewAudio writes into the host's temp/ folder only (wiped at every ComfyUI boot)
// run directly:  bun examples/rvion/13-ace-step-15-xl-t2a.cflow.ts ["prompt"] [seed]
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

const MODELS = {
   turbo: { unet: 'acestep_v1.5_xl_turbo_bf16.safetensors', steps: 8, cfg: 1, topP: 0.9 },
   sft: { unet: 'acestep_v1.5_xl_sft_bf16.safetensors', steps: 50, cfg: 7, topP: 1 },
   base: { unet: 'acestep_v1.5_xl_base_bf16.safetensors', steps: 50, cfg: 6, topP: 0.9 },
} as const

const KEYS = [
   'C major',
   'C# major',
   'Db major',
   'D major',
   'D# major',
   'Eb major',
   'E major',
   'F major',
   'F# major',
   'Gb major',
   'G major',
   'G# major',
   'Ab major',
   'A major',
   'A# major',
   'Bb major',
   'B major',
   'C minor',
   'C# minor',
   'Db minor',
   'D minor',
   'D# minor',
   'Eb minor',
   'E minor',
   'F minor',
   'F# minor',
   'Gb minor',
   'G minor',
   'G# minor',
   'Ab minor',
   'A minor',
   'A# minor',
   'Bb minor',
   'B minor',
] as const

export const aceStep15XlT2a = host.defineWorkflow({
   id: 'ace-step-15-xl-t2a',
   vars: {
      // FIRST line = the caption (genre, instruments, vocals, production), remaining lines = the lyrics
      // with [Verse] [Chorus] [Bridge] [Outro] tags (`//` lines are comments)
      prompt: v.prompt(
         [
            'A lush neo-soul track anchored by a warm Rhodes electric piano playing rich ninth chords over a loose, soulful live drum groove with ghost notes and rim shots. A fretless bass sings beneath the harmony. The lead vocalist is a powerful, expressive woman moving between a smoky chest voice and an airy falsetto. Warm, analog production with subtle tape saturation.',
            '',
            '[Verse 1]',
            'You never call when the neon goes dark',
            'Just send a signal like an afterthought',
            'I learned to read the silence between the lines',
            "And honey that's a language I know too well by now",
            '',
            '[Chorus]',
            "I'm done rewriting your story in my head",
            "Done saving room for someone who's already gone",
            "I'll keep the record on",
            "But I'll stop singing your part",
            '',
            '[Verse 2]',
            'The coffee shop still plays our favourite song',
            'I ordered something different, stayed too long',
            'But every note just proved that I was right',
            'To let the whole thing go before it burned my life',
            '',
            '[Outro]',
         ].join('\n'),
      ),
      seed: v.seed(42, { mode: '+' }),
      model: v.choice(['turbo', 'sft', 'base'], 'turbo', 'model'),
      seconds: v.float(120, { min: 10, max: 300, label: 'length (s)' }),
      bpm: v.int(120, { min: 10, max: 300, label: 'bpm' }),
      key: v.choice(KEYS, 'E minor', 'key'),
      timeSignature: v.choice(['2', '3', '4', '6'], '4', 'beats per bar'),
      language: v.choice(['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'zh'], 'en', 'language'),
   },
   build: (b, vars) => {
      const m = MODELS[vars.model]
      const [captionLine, ...lyricLines] = vars.prompt.positive.split('\n')
      const clip = b.DualCLIPLoader({
         clip_name1: 'qwen_0.6b_ace15.safetensors',
         clip_name2: 'qwen_4b_ace15.safetensors',
         type: 'ace',
         device: 'default',
      })
      const positive = b['TextEncodeAceStepAudio1.5']({
         clip,
         tags: captionLine ?? '',
         lyrics: lyricLines.join('\n').trim(),
         seed: vars.seed,
         bpm: vars.bpm,
         duration: vars.seconds,
         timesignature: vars.timeSignature,
         language: vars.language,
         keyscale: vars.key,
         generate_audio_codes: true,
         cfg_scale: 2,
         temperature: 0.85,
         top_p: m.topP,
         top_k: 0,
         min_p: 0,
      })
      const samples = b.KSampler({
         model: b.ModelSamplingAuraFlow({
            model: b.UNETLoader({ unet_name: m.unet, weight_dtype: 'default' }),
            shift: 3,
         }),
         positive,
         negative: b.ConditioningZeroOut({ conditioning: positive }),
         latent_image: b['EmptyAceStep1.5LatentAudio']({ seconds: vars.seconds, batch_size: 1 }),
         seed: vars.seed,
         steps: m.steps,
         cfg: m.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.PreviewAudio({
         audio: b.VAEDecodeAudio({ samples, vae: b.VAELoader({ vae_name: 'ace_1.5_vae.safetensors' }) }),
      })
   },
})

export default aceStep15XlT2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   if (process.argv[2]) aceStep15XlT2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) aceStep15XlT2a.vars.seed.set(Number(process.argv[3]))

   const execution = await aceStep15XlT2a.run({ log: true, save: { prefix: 'comfy-ts-example/ace-step-15-xl-t2a' } })
   for (const audio of execution.audios) console.log(`🟢 ${audio.absPath}`)
   host.disconnect()
}
