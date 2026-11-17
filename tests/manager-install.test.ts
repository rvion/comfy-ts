// installs go through the Manager queue API on all three servers in the field (agent/architecture.md,
// Manager HTTP client). The fake below serves each generation's route table as read in its
// source and 404s everything else, the old direct install routes included.
import { describe, expect, it } from 'bun:test'
import { ComfyManager, type ManagerGeneration } from 'src/host/ComfyManager.ts'
import type { ComfyManagerModelInfo } from 'src/manager/types/ComfyManagerModelInfo.ts'
import type { ComfyManagerPluginInfo } from 'src/manager/types/ComfyManagerPluginInfo.ts'

const model = {
   name: 'TAEF1 Decoder',
   type: 'TAESD',
   base: 'FLUX.1',
   save_path: 'vae_approx',
   description: 'taesd decoder',
   reference: 'https://github.com/madebyollin/taesd',
   filename: 'taef1_decoder.pth',
   url: 'https://github.com/madebyollin/taesd/raw/main/taef1_decoder.pth',
} as ComfyManagerModelInfo

// our mirror recovers `id` from the title: NOT the key the Manager installs by
const plugin = {
   id: 'ComfyUI Impact Pack',
   author: 'Dr.Lt.Data',
   title: 'ComfyUI Impact Pack',
   reference: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack',
   files: ['https://github.com/ltdrdata/ComfyUI-Impact-Pack'],
   install_type: 'git-clone',
   description: 'detailers',
} as ComfyManagerPluginInfo

const packs = {
   'comfyui-impact-pack': {
      title: 'ComfyUI Impact Pack',
      id: 'comfyui-impact-pack',
      files: ['https://github.com/ltdrdata/ComfyUI-Impact-Pack'],
      version: '8.28.3',
      state: 'not-installed',
   },
   'comfy-cliption': {
      title: 'Comfy Cliption',
      id: 'comfyui-cliption',
      files: ['https://github.com/pharmapsychotic/comfy-cliption'],
      version: 'nightly',
      state: 'enabled',
      'update-state': 'true',
   },
}

type Call = { method: string; route: string; body: unknown }
type Item = { uiId: string; kind: 'model' | 'plugin'; body: Record<string, unknown> }

class FakeManager {
   calls: Call[] = []
   queue: Item[] = []
   processing = false
   onDisk = new Set<string>()
   installed: Record<string, { cnr_id: string | null; aux_id: string | null; enabled: boolean }> = {}
   history: Record<string, unknown> = {}
   outcome: 'success' | 'error' = 'success'
   neverDrains = false
   refuseModel: string | null = null

   constructor(public gen: ManagerGeneration | 'none') {}

   get pre(): string {
      return this.gen === 'v3' ? '' : '/v2'
   }

   drain(): void {
      if (this.neverDrains) return
      for (const item of this.queue) {
         const ok = this.outcome === 'success'
         if (ok && item.kind === 'model') this.onDisk.add(String(item.body.filename))
         if (ok && item.kind === 'plugin')
            this.installed[String(item.body.id)] = { cnr_id: String(item.body.id), aux_id: null, enabled: true }
         this.history[item.uiId] = {
            status: { status_str: ok ? 'success' : 'error', messages: ok ? [] : ['Model installation error: boom'] },
         }
      }
      this.queue = []
      this.processing = false
   }

   manager(): ComfyManager {
      return new ComfyManager(
         { getServerHostHTTP: () => 'http://box:8188', fetch: (route, init) => this.serve(route, init) },
         { pollMs: 1, installTimeoutMs: 30 },
      )
   }

   serve = async (route: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET'
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      this.calls.push({ method, route, body })
      const record = (b: unknown): Record<string, unknown> => (typeof b === 'object' && b != null ? { ...b } : {})
      const g = this.gen
      const pre = this.pre
      const is = (m: string, r: string): boolean => method === m && route === r
      if (g === 'none') return new Response('', { status: 404 })
      if (is('GET', '/v2/manager/version')) return g === 'v3' ? new Response('', { status: 404 }) : new Response('4.4')
      if (is('GET', '/manager/version')) return g === 'v3' ? new Response('V3.42') : new Response('', { status: 404 })
      if (is('GET', '/v2/manager/is_legacy_manager_ui') && g !== 'v3')
         return Response.json({ is_legacy_manager_ui: g === 'v4-legacy-ui' })
      if (g !== 'v4' && is('GET', `${pre}/externalmodel/getlist?mode=cache`))
         return Response.json({ models: [{ ...model, installed: this.onDisk.has(model.filename) ? 'True' : 'False' }] })
      if (g !== 'v4' && method === 'GET' && route.startsWith(`${pre}/customnode/getlist?`))
         return Response.json({ channel: 'default', node_packs: packs })
      if (is('GET', `${pre}/customnode/installed`)) return Response.json(this.installed)
      if (is('POST', `${pre}/manager/queue/install_model`)) {
         if (this.refuseModel != null) return new Response(this.refuseModel, { status: 400 })
         const b = record(body)
         if (g === 'v4' && (b.client_id == null || b.ui_id == null))
            return new Response('Missing required field', { status: 400 })
         this.queue.push({ uiId: String(b.ui_id), kind: 'model', body: b })
         return new Response('')
      }
      if (g === 'v3' && is('POST', '/manager/queue/install')) {
         const b = record(body)
         this.queue.push({ uiId: String(b.ui_id), kind: 'plugin', body: b })
         return new Response('')
      }
      if (g === 'v4-legacy-ui' && is('POST', '/v2/manager/queue/batch')) {
         const list = record(body).install
         for (const x of Array.isArray(list) ? list : [])
            this.queue.push({ uiId: String(record(x).ui_id), kind: 'plugin', body: record(x) })
         this.processing = true
         return Response.json({ failed: [] })
      }
      if (g === 'v4' && is('POST', '/v2/manager/queue/task')) {
         const b = record(body)
         this.queue.push({
            uiId: String(b.ui_id),
            kind: b.kind === 'install' ? 'plugin' : 'model',
            body: record(b.params),
         })
         return new Response('')
      }
      if (is('POST', `${pre}/manager/queue/start`)) {
         const started = !this.processing
         this.processing = true
         return new Response('', { status: started ? 200 : 201 })
      }
      if (is('GET', `${pre}/manager/queue/status`)) {
         this.drain()
         return Response.json({ total_count: 0, done_count: 0, in_progress_count: 0, is_processing: this.processing })
      }
      if (g === 'v4' && method === 'GET' && route.startsWith('/v2/manager/queue/history?ui_id=')) {
         this.drain()
         return Response.json({ history: this.history[decodeURIComponent(route.split('=')[1] ?? '')] ?? {} })
      }
      return new Response('', { status: 404 })
   }

   routes(): string[] {
      return this.calls.map((c) => `${c.method} ${c.route.split('?')[0]}`)
   }
}

async function capturingErrors<T>(fn: () => Promise<T>): Promise<{ value: T; errors: string }> {
   const errors: string[] = []
   const original = console.error
   console.error = (...a: unknown[]): void => void errors.push(a.map(String).join(' '))
   try {
      const value = await fn()
      return { value, errors: errors.join('\n') }
   } finally {
      console.error = original
   }
}

describe('installModel', () => {
   it('V3: queues, starts, waits for the drain, then checks the model is on disk', async () => {
      const box = new FakeManager('v3')
      expect(await box.manager().installModel(model)).toBe(true)
      expect(box.routes()).toEqual([
         'GET /v2/manager/version',
         'GET /manager/version',
         'POST /manager/queue/install_model',
         'POST /manager/queue/start',
         'GET /manager/queue/status',
         'GET /externalmodel/getlist',
      ])
      expect(box.onDisk.has('taef1_decoder.pth')).toBe(true)
   })

   it('4.x legacy ui: the same steps under /v2', async () => {
      const box = new FakeManager('v4-legacy-ui')
      expect(await box.manager().installModel(model)).toBe(true)
      expect(box.routes()).toContain('POST /v2/manager/queue/install_model')
      expect(box.routes()).toContain('GET /v2/externalmodel/getlist')
   })

   it('4.x: the body carries ui_id AND client_id, the outcome is the task history', async () => {
      const box = new FakeManager('v4')
      expect(await box.manager().installModel(model)).toBe(true)
      const sent = box.calls.find((c) => c.route === '/v2/manager/queue/install_model')
      expect(sent?.body).toMatchObject({
         filename: 'taef1_decoder.pth',
         ui_id: expect.any(String),
         client_id: expect.any(String),
      })
      expect(box.routes()).toContain('GET /v2/manager/queue/history')
      expect(box.routes()).not.toContain('GET /v2/externalmodel/getlist')
   })

   it('4.x: a task the Manager reports failed resolves false with its message', async () => {
      const box = new FakeManager('v4')
      box.outcome = 'error'
      const r = await capturingErrors(() => box.manager().installModel(model))
      expect(r.value).toBe(false)
      expect(r.errors).toContain('the Manager reports error: Model installation error: boom')
   })

   it('V3: a drained queue without the file on disk is a failure, not a success', async () => {
      const box = new FakeManager('v3')
      box.outcome = 'error'
      const r = await capturingErrors(() => box.manager().installModel(model))
      expect(r.value).toBe(false)
      expect(r.errors).toContain('the Manager queue drained but it is not installed')
   })

   it('the host refusing the request names the route and what it said', async () => {
      const box = new FakeManager('v3')
      box.refuseModel = 'Invalid model install request is detected'
      const r = await capturingErrors(() => box.manager().installModel(model))
      expect(r.value).toBe(false)
      expect(r.errors).toContain('POST /manager/queue/install_model → 400 Invalid model install request is detected')
      expect(box.routes()).not.toContain('POST /manager/queue/start')
   })

   it('the deadline passes: false, naming the setting', async () => {
      const box = new FakeManager('v3')
      box.neverDrains = true
      const r = await capturingErrors(() => box.manager().installModel(model))
      expect(r.value).toBe(false)
      expect(r.errors).toContain('still running after 30 ms (manager.timing.installTimeoutMs)')
   })

   it('no Manager at all: false, naming both probes', async () => {
      const box = new FakeManager('none')
      const r = await capturingErrors(() => box.manager().installModel(model))
      expect(r.value).toBe(false)
      expect(r.errors).toContain('GET /v2/manager/version → 404, GET /manager/version → 404')
   })

   it('the generation is probed once per manager', async () => {
      const box = new FakeManager('v3')
      const manager = box.manager()
      await manager.installModel(model)
      await manager.installModel(model)
      expect(box.routes().filter((r) => r.endsWith('/manager/version')).length).toBe(2)
   })
})

describe('installPlugin', () => {
   it('V3: sends the Manager its own list row, keyed by its install key, never our mirror id', async () => {
      const box = new FakeManager('v3')
      expect(await box.manager().installPlugin(plugin)).toBe(true)
      const sent = box.calls.find((c) => c.route === '/manager/queue/install')
      expect(sent?.body).toMatchObject({
         id: 'comfyui-impact-pack',
         version: '8.28.3',
         channel: 'default',
         mode: 'cache',
         skip_post_install: false,
      })
      expect(box.routes()).toContain('GET /customnode/installed')
   })

   it('4.x legacy ui: the row goes through queue/batch', async () => {
      const box = new FakeManager('v4-legacy-ui')
      expect(await box.manager().installPlugin(plugin)).toBe(true)
      const sent = box.calls.find((c) => c.route === '/v2/manager/queue/batch')
      expect(sent?.body).toMatchObject({ install: [{ id: 'comfyui-impact-pack' }] })
   })

   it('4.x: a queue task by repo name at nightly, the outcome from history', async () => {
      const box = new FakeManager('v4')
      expect(await box.manager().installPlugin(plugin)).toBe(true)
      const sent = box.calls.find((c) => c.route === '/v2/manager/queue/task')
      expect(sent?.body).toMatchObject({
         kind: 'install',
         client_id: expect.any(String),
         params: {
            id: 'comfyui-impact-pack',
            selected_version: 'nightly',
            repository: plugin.files[0],
            channel: 'default',
            mode: 'cache',
         },
      })
      expect(box.routes()).not.toContain('GET /v2/customnode/getlist')
   })

   it('a pack the Manager does not list is refused before anything is queued', async () => {
      const box = new FakeManager('v3')
      const stranger = { ...plugin, files: ['https://github.com/nobody/nothing'] } as ComfyManagerPluginInfo
      const r = await capturingErrors(() => box.manager().installPlugin(stranger))
      expect(r.value).toBe(false)
      expect(r.errors).toContain("https://github.com/nobody/nothing is not in the Manager's own list")
      expect(box.routes()).not.toContain('POST /manager/queue/install')
   })
})

describe('fetchPlugins', () => {
   it('normalizes the V3 node_packs wire shape into the public custom_nodes list', async () => {
      const list = await new FakeManager('v3').manager().fetchPlugins()
      expect(list).toEqual({
         chanel: 'default',
         custom_nodes: [
            { title: 'ComfyUI Impact Pack', installed: 'False' },
            { title: 'Comfy Cliption', installed: 'Update' },
         ],
      } as typeof list)
   })

   it('4.x default ui serves no list: the error says how to get one', async () => {
      await expect(new FakeManager('v4').manager().fetchPlugins()).rejects.toThrow(
         /ComfyUI-Manager 4\.4 \(v4\) does not serve \/customnode\/getlist: start ComfyUI with --enable-manager-legacy-ui/,
      )
   })
})
