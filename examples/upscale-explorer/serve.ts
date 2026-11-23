// upscale explorer: drop any image, run every upscaler the host has at one scale, compare them
// where print shows it: a synced loupe at 100 % pixels, and a pair in five compare modes.
//    bun examples/upscale-explorer/serve.ts [--samples <dir>]   →  http://127.0.0.1:8294
import { serveExplorer } from '../explorer-kit/server.ts'
import { MODELS, type Scale } from './models.ts'
import page from './web/index.html'

await serveExplorer({
   name: 'upscale explorer',
   port: 8294,
   page,
   catalog: MODELS,
   card: (m) => ({ kind: m.kind, tier: m.tier, arch: m.arch, native: m.native, license: m.license }),
   readParams: (raw): { scale: Scale } => {
      if (raw.scale === 2 || raw.scale === 4) return { scale: raw.scale }
      throw new Error('body needs { scale: 2 | 4 }')
   },
   build: (wf, image, m, p) => m.build(wf, image, p),
})
