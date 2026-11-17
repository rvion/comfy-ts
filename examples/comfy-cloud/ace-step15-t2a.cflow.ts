// ace-step15 t2a on Comfy Cloud — ACE-Step 1.5 text to song: a caption + tagged lyrics to a full mp3 track, four models behind one choice
// source template: audio_ace_step_1_5_split.json (official workflow-templates), the xl choices follow audio_ace_step1_5_xl_{turbo,sft,base}.json
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: audio outputs PERSIST on the host (upstream ships no websocket saver for audio — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/ace-step15-t2a.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// each model with its own template's sampling and lm encoder
const MODELS = {
   turbo: { unet: 'acestep_v1.5_turbo.safetensors', lm: 'qwen_1.7b_ace15.safetensors', steps: 8, cfg: 1, topP: 0.9 },
   'xl turbo': {
      unet: 'acestep_v1.5_xl_turbo_bf16.safetensors',
      lm: 'qwen_4b_ace15.safetensors',
      steps: 8,
      cfg: 1,
      topP: 0.9,
   },
   'xl sft': {
      unet: 'acestep_v1.5_xl_sft_bf16.safetensors',
      lm: 'qwen_4b_ace15.safetensors',
      steps: 50,
      cfg: 7,
      topP: 1,
   },
   'xl base': {
      unet: 'acestep_v1.5_xl_base_bf16.safetensors',
      lm: 'qwen_4b_ace15.safetensors',
      steps: 50,
      cfg: 6,
      topP: 0.9,
   },
} as const

// the 12 keys of each mode, spelled the way the encoder's keyscale list spells them
const KEYS = [
   'C major',
   'C# major',
   'D major',
   'Eb major',
   'E major',
   'F major',
   'F# major',
   'G major',
   'Ab major',
   'A major',
   'Bb major',
   'B major',
   'C minor',
   'C# minor',
   'D minor',
   'Eb minor',
   'E minor',
   'F minor',
   'F# minor',
   'G minor',
   'Ab minor',
   'A minor',
   'Bb minor',
   'B minor',
] as const

export const aceStep15T2a = host.defineWorkflow({
   id: 'ace-step15-t2a',
   vars: {
      // ONE prompt var: FIRST line = the caption (genre, instruments, vocals, production), remaining lines = lyrics
      // with [Verse] [Chorus] [Bridge] tags (`//` lines are comments)
      prompt: v.prompt(
         [
            'K-Pop: A slick, maximalist K-pop track that genre-hops with precision and style: a hard-hitting trap-influenced verse with rapid-fire rapping, a softer R&B pre-chorus with breathy vocals and lush harmonies, then an explosive, synth-driven pop chorus with an earworm hook.',
            '',
            '[Intro - Synth Rise & Vocal Chop]',
            'yeah',
            'turn it up',
            '',
            '[Verse 1 - Trap Rap]',
            'Click-clack, camera flash, we never miss',
            'Run the board, every move calculated',
            'Big bass hit when I step in the frame',
            'Too fast, they can never say my name',
            '',
            '[Pre-Chorus - R&B]',
            'Pull me closer, slow it down',
            'Heartbeat under the sound',
            '',
            '[Chorus - Pop Explosion]',
            'Boom, boom, feel it in your chest',
            'When the beat drop, we the best',
            'Hands up high, do not overthink',
            'Say my name, make the whole world blink',
         ].join('\n'),
      ),
      seed: v.seed(42),
      model: v.choice(['turbo', 'xl turbo', 'xl sft', 'xl base'], 'turbo', 'model'),
      // the encoder plans the song to this length, the latent is sized to it
      seconds: v.float(120, { min: 10, max: 600 }),
      bpm: v.int(190, { min: 10, max: 300 }),
      key: v.choice(KEYS, 'E minor', 'key'),
      language: v.choice(['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'zh'], 'en', 'language'),
   },
   build: (b, vars) => {
      const m = MODELS[vars.model]
      const [captionLine, ...lyricLines] = vars.prompt.positive.split('\n')
      // a 0.6b qwen embeds the text, a larger one writes the audio codes the dit follows
      const positive = b['TextEncodeAceStepAudio1.5']({
         clip: b.DualCLIPLoader({
            clip_name1: 'qwen_0.6b_ace15.safetensors',
            clip_name2: m.lm,
            type: 'ace',
            device: 'default',
         }),
         tags: captionLine ?? '',
         lyrics: lyricLines.join('\n').trim(),
         seed: vars.seed,
         bpm: vars.bpm,
         duration: vars.seconds,
         timesignature: '4',
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
      b.SaveAudioAdvanced({
         audio: b.VAEDecodeAudio({ samples, vae: b.VAELoader({ vae_name: 'ace_1.5_vae.safetensors' }) }),
         filename_prefix: 'comfy-ts-zoo/ace-step15-t2a',
         format: 'mp3',
         'format.quality': 'V0',
      })
   },
})

export default aceStep15T2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) aceStep15T2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) aceStep15T2a.vars.seed.set(Number(process.argv[3]))
   const execution = await aceStep15T2a.run({ log: true, save: { prefix: 'comfy-ts-zoo/ace-step15-t2a' } })
   for (const audio of execution.audios) console.log(`🟢 ${audio.absPath}`)
   host.disconnect()
}
