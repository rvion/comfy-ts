// the text a media file carries beside it: a media var set from `clip.flac` whose declaration
// links a text var (`v.audio(path, { sidecarText })`) fills that var from `clip.txt`, unless the
// flags set it. The link is the workflow's, so run knows no var name
import type { AnyVar, MediaVar } from 'src/vars/ComfyVars.ts'
import { sidecarPath } from 'src/cli/run/outputPaths.ts'

const MEDIA = new Set(['image', 'audio', 'video'])

/** each var to fill, with the sidecar it comes from */
export function sidecarFills(
   entries: readonly (readonly [string, AnyVar])[],
   payload: Readonly<Record<string, unknown>>,
   exists: (path: string) => boolean,
): { name: string; from: string }[] {
   const out: { name: string; from: string }[] = []
   for (const [k, v] of entries) {
      const path = payload[k]
      // kind, never instanceof (agent/coding.md cast whitelist 6)
      if (!MEDIA.has(v.kind) || typeof path !== 'string' || /^https?:\/\//.test(path)) continue
      const linked = (v as MediaVar).opts.sidecarText
      const name = linked == null ? null : entries.find(([, x]) => x === linked)?.[0]
      if (name == null || name in payload || out.some((o) => o.name === name)) continue
      const from = sidecarPath(path)
      if (exists(from)) out.push({ name, from })
   }
   return out
}
