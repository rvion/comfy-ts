// one narrator line of the cut: `sk sound voice` with the picked ElevenLabs voice (liam: young, articulate, calm),
// the key read from the house secret manager into the child's environment only, never printed or written.
//   bun trailer/comfy-ts/film/voice.ts "<line>" <out.wav>
// This repo keeps no brand file (a brand renders favicon and og pictures into a web root it does not have), so
// the voice is named here instead of in the brand's `trailer.voice`.
const NARRATOR = 'TX3LPaxmHKxFdv7VOQHJ'

const [line, out] = process.argv.slice(2)
if (line == null || out == null) throw new Error('usage: voice.ts "<line>" <out.wav>')

const key = Bun.spawnSync(['sk', 'secret', 'get', 'rv/elevenlabs/api-key'], { stderr: 'inherit' })
if (key.exitCode !== 0) throw new Error('no ElevenLabs key: sk secret get rv/elevenlabs/api-key failed')
const p = Bun.spawnSync(['sk', 'sound', 'voice', line, '--eleven', NARRATOR, '--stability', '0.5', '--out', out], {
   env: { ...process.env, ELEVENLABS_API_KEY: key.stdout.toString().trim() },
   stdout: 'inherit',
   stderr: 'inherit',
})
process.exit(p.exitCode ?? 1)
