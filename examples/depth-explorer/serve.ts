// depth explorer: drop any image, run every depth / normal estimator the host has, compare them
// side by side, as a 3D relief or relit by the normals.
//    bun examples/depth-explorer/serve.ts [--samples <dir>]   →  http://127.0.0.1:8292
import { serveExplorer } from '../explorer-kit/server.ts'
import { MODELS } from './models.ts'
import page from './web/index.html'

await serveExplorer({
   name: 'depth explorer',
   port: 8292,
   page,
   catalog: MODELS,
   card: (m) => ({ kind: m.kind, tier: m.tier }),
   readParams: (raw) => {
      if (typeof raw.detail !== 'number') throw new Error('body needs { detail: number }')
      return { detail: Math.min(2048, Math.max(256, Math.round(raw.detail))) }
   },
   build: (wf, image, m, p) => m.build(wf.builder, image, { detail: p.detail, wf }),
})
