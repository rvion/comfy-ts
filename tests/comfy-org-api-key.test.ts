// a paid partner API node reads the Comfy account key from extra_data.api_key_comfy_org. The key
// rides the posted body and nothing else; a partner node with no key fails before any POST.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { InvalidPromptError } from 'src/errors/InvalidPromptError.ts'
import type { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import { ComfyOrgApiKeyMissingError } from 'src/runner/comfyOrgApiKey.ts'
import { PromptID_ark } from 'src/runner/ComfyWsApi.ts'
import { ComfyTS } from 'src/state.ts'

const KEY = 'test-account-key-not-a-real-one'
const OTHER = 'test-run-key-not-a-real-one'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
const servers: ReturnType<typeof Bun.serve>[] = []
let posts: { [k: string]: unknown }[] = []
let reject = false

beforeEach(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   posts = []
   reject = false
})
afterEach(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
   for (const s of servers.splice(0)) s.stop(true)
})

/** the fixture schema, EmptyLatentImage marked as a partner node */
function spec(): unknown {
   const raw: { [k: string]: { [k: string]: unknown } } = JSON.parse(
      readFileSync('tests/fixtures/object_info.json', 'utf-8'),
   )
   const node = raw['EmptyLatentImage']
   if (node == null) throw new Error('fixture lost EmptyLatentImage')
   node['api_node'] = true
   return raw
}

/** a fake ComfyUI that records every POST /api/prompt body */
function fakeHost(data: { id: string; comfyOrgApiKey?: string | (() => string | undefined) }): ComfyHost<string> {
   const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
         if (new URL(req.url).pathname !== '/api/prompt' || req.method !== 'POST')
            return new Response('not found', { status: 404 })
         posts.push(await req.json())
         if (reject) return Response.json({ error: { message: 'refused', details: '' } }, { status: 400 })
         return Response.json({ prompt_id: `p-${posts.length}`, number: 1, node_errors: {} })
      },
   })
   servers.push(server)
   const comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-orgkey-')) })
   const host = comfy.host({ url: `http://127.0.0.1:${server.port}`, ...data })
   host.schema.update({ spec: spec(), embeddings: [] })
   host.connect = () => Promise.resolve()
   // start() refuses a host with no ws; the socket itself is never used here
   host.ws = {} as never
   return host
}

const partnerWorkflow = (host: ComfyHost<string>) => {
   const wf = host.workflow({ id: 'paid' })
   wf.builder.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 })
   return wf
}
const freeWorkflow = (host: ComfyHost<string>) => {
   const wf = host.workflow({ id: 'free' })
   wf.builder.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
   return wf
}

/** end the run the fake host never runs, so no watchdog outlives the test */
function finish(host: ComfyHost<string>, execution: ComfyExecution): void {
   const id = PromptID_ark.assert(execution.data.id)
   host.routeOrBuffer(id, { type: 'execution_success', data: { prompt_id: id, timestamp: 0 } })
}

const extraData = (i: number): { [k: string]: unknown } => {
   const body = posts[i]
   if (body == null) throw new Error(`no post #${i}`)
   const extra = body['extra_data']
   if (extra == null || typeof extra !== 'object') throw new Error('no extra_data')
   return { ...extra }
}

describe('extra_data.api_key_comfy_org', () => {
   it('the host key rides the posted body, and nowhere else', async () => {
      const host = fakeHost({ id: 'h-key', comfyOrgApiKey: KEY })
      const said: string[] = []
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => {
         const real = console[m]
         console[m] = (...args: unknown[]): void => void said.push(args.map(String).join(' '))
         return () => void (console[m] = real)
      })
      try {
         const execution = await partnerWorkflow(host).start()
         finish(host, execution)
         await execution.done
         expect(extraData(0)['api_key_comfy_org']).toBe(KEY)
         expect(JSON.stringify(extraData(0)['extra_pnginfo'])).not.toContain(KEY)
         expect(JSON.stringify(posts[0]?.['prompt'])).not.toContain(KEY)
         expect(JSON.stringify(execution.snapshot)).not.toContain(KEY)
         expect(JSON.stringify(execution.data)).not.toContain(KEY)
      } finally {
         for (const undo of spies) undo()
      }
      expect(said.join('\n')).not.toContain(KEY)
   })

   it('a prompt with no partner node never reads nor sends the key', async () => {
      let reads = 0
      const host = fakeHost({
         id: 'h-free',
         comfyOrgApiKey: () => {
            reads++
            return KEY
         },
      })
      const execution = await freeWorkflow(host).start()
      finish(host, execution)
      expect(reads).toBe(0)
      expect('api_key_comfy_org' in extraData(0)).toBe(false)
   })

   it('a run key overrides the host key, through DefinedWorkflow.run too', async () => {
      const host = fakeHost({ id: 'h-run', comfyOrgApiKey: KEY })
      const dw = host.defineWorkflow({
         id: 'paid-defined',
         vars: {},
         build: (b) => void b.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 }),
      })
      const done = dw.run({ comfyOrgApiKey: async () => OTHER })
      while (posts.length === 0) await Bun.sleep(1)
      const id = PromptID_ark.assert('p-1')
      while (!host.executions.has(id)) await Bun.sleep(1)
      host.routeOrBuffer(id, { type: 'execution_success', data: { prompt_id: id, timestamp: 0 } })
      await done
      expect(extraData(0)['api_key_comfy_org']).toBe(OTHER)
   })

   it('a partner node with no key fails before any POST, naming the node', async () => {
      const host = fakeHost({ id: 'h-none', comfyOrgApiKey: () => undefined })
      const err: unknown = await partnerWorkflow(host)
         .start()
         .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ComfyOrgApiKeyMissingError)
      expect(String(err)).toContain('EmptyLatentImage #')
      expect(String(err)).toContain('comfyOrgApiKey')
      expect(posts).toHaveLength(0)
   })

   it('a refused prompt keeps the key out of the error', async () => {
      const host = fakeHost({ id: 'h-refused', comfyOrgApiKey: KEY })
      reject = true
      const err: unknown = await partnerWorkflow(host)
         .start()
         .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(InvalidPromptError)
      expect(extraData(0)['api_key_comfy_org']).toBe(KEY)
      expect(String(err)).not.toContain(KEY)
      if (err instanceof InvalidPromptError) expect(JSON.stringify(err.snapshot)).not.toContain(KEY)
   })

   it('a later host() call with a key hands it to the registered host', async () => {
      const host = fakeHost({ id: 'h-later' })
      const again = ComfyTS.create().host({ id: 'h-later', comfyOrgApiKey: KEY })
      expect(again).toBe(host)
      const execution = await partnerWorkflow(host).start()
      finish(host, execution)
      expect(extraData(0)['api_key_comfy_org']).toBe(KEY)
   })

   it('a Comfy Cloud host sends its own api key when no account key is set', async () => {
      const comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-orgkey-cloud-')) })
      const host = comfy.host({ id: 'cloud-test', url: 'https://cloud.comfy.org', apiKey: KEY, sdkAutoWrite: false })
      host.schema.update({ spec: spec(), embeddings: [] })
      host.ws = {} as never
      const bodies: string[] = []
      host.fetch = (_route, init) => {
         bodies.push(String(init?.body))
         return Promise.resolve(new Response(JSON.stringify({ error: { message: 'stop here' } }), { status: 400 }))
      }
      await partnerWorkflow(host)
         .start()
         .catch(() => {})
      const sent: unknown = JSON.parse(bodies[0] ?? '{}')
      expect(sent).toMatchObject({ extra_data: { api_key_comfy_org: KEY } })
   })
})
