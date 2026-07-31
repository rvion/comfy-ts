// ace-step t2a on Comfy Cloud — ACE-Step v1 3.5B text to song: style tags + lyrics to a full mp3 track
// source template: audio_ace_step_1_t2a_song.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: audio outputs PERSIST on the host (upstream ships no websocket saver for audio — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/ace-step-t2a.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const aceStepT2a = host.defineWorkflow({
   id: 'ace-step-t2a',
   vars: {
      // ONE prompt var: FIRST line = style tags, remaining lines = lyrics (`//` lines are comments)
      prompt: v.prompt(
         [
            'anime, soft female vocals, kawaii pop, j-pop, childish, piano, guitar, synthesizer, fast, happy, cheerful, lighthearted',
            '',
            'Verse',
            'Neon rain on my screen,',
            'Dreams compile in silver sheen.',
            'No weight, just motion,',
            'I’m plugged into emotion.',
            '',
            'Chorus',
            'Comfy Cloud — breathing light,',
            'Code and color, spark and wire.',
            'Drift through data, feel alive,',
            'In your circuits, I arrive.',
         ].join('\n'),
      ),
      seed: v.seed(42),
      seconds: v.float(120, { min: 1, max: 1000 }),
      steps: v.int(50, { min: 1, max: 100 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'ace_step_v1_3.5b.safetensors' })
      const [tagsLine, ...lyricLines] = vars.prompt.positive.split('\n')
      const positive = b.TextEncodeAceStepAudio({
         clip: ckpt,
         tags: tagsLine ?? '',
         lyrics: lyricLines.join('\n').trim(),
         lyrics_strength: 0.99,
      })
      const samples = b.KSampler({
         // tonemap CFG on the model keeps high-cfg audio from clipping (template's sampling chain)
         model: b.LatentApplyOperationCFG({
            model: b.ModelSamplingSD3({ model: ckpt, shift: 5 }),
            operation: b.LatentOperationTonemapReinhard({ multiplier: 1 }),
         }),
         positive,
         negative: b.ConditioningZeroOut({ conditioning: positive }),
         latent_image: b.EmptyAceStepLatentAudio({ seconds: vars.seconds, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 5,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveAudioMP3({
         audio: b.VAEDecodeAudio({ samples, vae: ckpt }),
         filename_prefix: 'comfy-ts-zoo/ace-step-t2a',
         quality: 'V0',
      })
   },
})

export default aceStepT2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) aceStepT2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) aceStepT2a.vars.seed.set(Number(process.argv[3]))
   const execution = await aceStepT2a.run({ log: true })
   // SaveAudio outputs land host side (no auto-download for audio yet)
   console.log(`🟢 ${execution.status}: audio saved on the host under comfy-ts-zoo/ace-step-t2a`)
   host.disconnect()
}
