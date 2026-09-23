// minimax-music3 t2a on Comfy Cloud — MiniMax Music 3 text to song: a structured caption + tagged lyrics to a full mp3 track
// source template: audio_minimax_music_3.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// note: audio outputs PERSIST on the host (upstream ships no websocket saver for audio — image examples stream ephemerally)
// run directly:  bun examples/comfy-cloud/minimax-music3-t2a.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const minimaxMusic3T2a = host.defineWorkflow({
   id: 'minimax-music3-t2a',
   vars: {
      // ONE prompt var: FIRST line = the caption (Global Metadata → Vocal Details → Arrangement), remaining lines = lyrics
      // with [Intro] [Verse] [Chorus] [Bridge] [Outro] tags, the only structural instructions the model follows (`//` lines are comments)
      prompt: v.prompt(
         [
            'Global Metadata: Lo-fi hip-hop, chillhop. 78 BPM, D flat major, jazzy extensions. Laid-back and dreamy, a warm late-night glow, heavy vinyl crackle and tape hiss. Vocal Details: Soft androgynous vocal, hushed half-sung half-spoken delivery, low in the mix, occasional wordless "mmm" and "ooh" hums in tape delay. Arrangement: Dusty boom-bap drums, round sub bass, warm Rhodes chords, mellow jazzy guitar licks; rain and vinyl noise intro, drums drop away in the bridge, fade out on a last Rhodes chord.',
            '',
            '[Intro]',
            'Mmm...',
            '(rain on the window)',
            '',
            '[Verse]',
            'Midnight and the canvas glows',
            'Dragging little wires where the current flows',
            'Type a quiet dream, let the sampler drift',
            'Noise into a picture, like the fog just lifts',
            '',
            '[Chorus]',
            'Mmm... let it render on',
            '(take your time, take your time)',
            'Ooh... by the morning it will all be done',
            '',
            '[Outro]',
            'Mmm...',
            'Ooh... goodnight',
         ].join('\n'),
      ),
      seed: v.seed(42),
      // an upper bound: the model can end the song earlier
      seconds: v.float(60, { min: 1, max: 300 }),
      steps: v.int(30, { min: 1, max: 100 }),
   },
   build: (b, vars) => {
      const [captionLine, ...lyricLines] = vars.prompt.positive.split('\n')
      const encoded = b.MiniMaxMusic3TextEncode({
         clip: b.CLIPLoader({
            clip_name: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
            type: 'minimax',
            device: 'default',
         }),
         caption: captionLine ?? '',
         lyrics: lyricLines.join('\n').trim(),
         seed: vars.seed,
         max_duration: vars.seconds,
         cfg_scale: 1.7,
         top_k: 50,
      })
      const vae = b.VAELoader({ vae_name: 'minimax_music3_dav.safetensors' })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'minimax_music3_dit_fp16.safetensors', weight_dtype: 'default' }),
         positive: encoded.outputs.CONDITIONING,
         negative: b.ConditioningZeroOut({ conditioning: encoded.outputs.CONDITIONING }),
         // the encoder reports the duration it planned for the lyrics, the latent is sized from it
         latent_image: b.EmptyMiniMaxMusic3LatentAudio({ seconds: encoded.outputs.seconds, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1.7,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveAudioAdvanced({
         // tiled decode: the template default, it keeps long songs inside VRAM
         audio: b.VAEDecodeAudioTiled({ samples, vae, tile_size: 1536, overlap: 64 }),
         filename_prefix: 'comfy-ts-zoo/minimax-music3-t2a',
         format: 'mp3',
         'format.quality': 'V0',
      })
   },
})

export default minimaxMusic3T2a

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) minimaxMusic3T2a.vars.prompt.set(process.argv[2])
   if (process.argv[3]) minimaxMusic3T2a.vars.seed.set(Number(process.argv[3]))
   const execution = await minimaxMusic3T2a.run({ log: true })
   // SaveAudio outputs land host side (no auto-download for audio yet)
   console.log(`🟢 ${execution.status}: audio saved on the host under comfy-ts-zoo/minimax-music3-t2a`)
   host.disconnect()
}
