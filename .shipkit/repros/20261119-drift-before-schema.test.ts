// why we think it is actually a bug, and not just meaning spec should change: checkSchemaDrift says "what changed on the host since this schema was loaded"; a host whose schema was never loaded (the TUI probes a host before its first run loads it) has nothing to compare, yet it reports every live node type as added ("changed: +2856 node types · a → re-codegen") on a project whose cache holds those same 2856 types, and a light check never clears it.
import { afterAll, beforeAll, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { summarizeDrift } from 'src/host/schemaDrift.ts'
import { ComfyTS } from 'src/state.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS
beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-drift-')) })
})
afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

const node = { input: { required: {} }, output: [], output_name: [], name: 'X', display_name: 'X', category: 'x', output_node: false, python_module: 'nodes' }
const live = { KSampler: node, VAEDecode: node, SaveImage: node }
const answering = (spec: Record<string, unknown>) => async (): Promise<Response> =>
   new Response(JSON.stringify(spec), { headers: { 'content-type': 'application/json' } })

it('a host whose schema was never loaded reports no drift', async () => {
   const host = comfy.host({ id: 'never-loaded', host: '127.0.0.1', port: 65501 })
   host.fetch = answering(live)
   expect(summarizeDrift(await host.checkSchemaDrift({ full: true }))).toBe('')
})

it('control: a loaded schema still reports a node type the host gained', async () => {
   const host = comfy.host({ id: 'loaded', host: '127.0.0.1', port: 65502 })
   host.schema.update({ spec: { KSampler: node, VAEDecode: node } as never, embeddings: [] })
   host.fetch = answering(live)
   expect(summarizeDrift(await host.checkSchemaDrift({ full: true }))).toBe('+1 node type')
})
