// stable-audio t2a on Comfy Cloud — Stable Audio Open 1.0 text to audio, up to ~47s, mp3 out
// source template: audio_stable_audio_example.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/stable-audio-t2a.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const stableAudioT2a = host.defineWorkflow({
   id: 'stable-audio-t2a',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt('heaven church electronic dance music'),
      seed: v.seed(42),
      seconds: v.float(47.6, { min: 1, max: 1000 }),
      steps: v.int(50, { min: 1, max: 100 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'stable-audio-open-1.0.safetensors' })
      const clip = b.CLIPLoader({ clip_name: 't5-base.safetensors', type: 'stable_audio', device: 'default' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip, text: vars.prompt.positive }),
         negative: b.CLIPTextEncode({ clip, text: vars.prompt.negative }),
         latent_image: b.EmptyLatentAudio({ seconds: vars.seconds, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 4.98,
         sampler_name: 'dpmpp_3m_sde_gpu',
         scheduler: 'exponential',
         denoise: 1,
      })
      b.SaveAudioMP3({
         audio: b.VAEDecodeAudio({ samples, vae: ckpt }),
         filename_prefix: 'comfy-ts-zoo/stable-audio-t2a',
         quality: 'V0',
      })
   },
})

export default stableAudioT2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) stableAudioT2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) stableAudioT2a.vars.seed.set(Number(process.argv[3]))
   const execution = await stableAudioT2a.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
