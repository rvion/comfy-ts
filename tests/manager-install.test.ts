// installs go through the Manager queue API on all three servers in the field (agent/architecture.md,
// Manager HTTP client). The fake below serves each generation's route table as read in its
// source and 404s everything else, the old direct install routes included.
import { describe, expect, it } from 'bun:test'
import { ComfyManager, type ManagerGeneration } from 'src/host/ComfyManager.ts'
import type { ManagerMirror } from 'src/manager/installedView.ts'
import type { Requirements } from 'src/host/Requirements.ts'
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

const row = (title: string, repo: string): ComfyManagerPluginInfo =>
   ({
      id: title,
      author: 'someone',
      title,
      reference: `https://github.com/${repo}`,
      files: [`https://github.com/${repo}`],
      install_type: 'git-clone',
      description: '',
   }) as ComfyManagerPluginInfo

const modelRow = (name: string, type: string, save_path: string, filename: string): ComfyManagerModelInfo =>
   ({
      name,
      type,
      base: 'SD1.5',
      save_path,
      description: '',
      reference: '',
      filename,
      url: `https://huggingface.co/x/${filename}`,
   }) as ComfyManagerModelInfo

const mirrorPlugins = [
   plugin,
   row('Comfy Cliption', 'pharmapsychotic/comfy-cliption'),
   row('Disabled Pack', 'someone/disabled-pack'),
   row('Missing Pack', 'someone/missing-pack'),
   row('Unmapped Pack', 'someone/unmapped-pack'),
   row('Cased Pack', 'someone/ComfyUI-Cased'),
]
const mirrorModels = [
   model,
   modelRow('Missing Model', 'checkpoint', 'default', 'missing.safetensors'),
   modelRow('Sub Model', 'checkpoint', 'checkpoints/SD1.5', 'sub.ckpt'),
   modelRow('HF Model', 'diffusers', 'diffusers', '<huggingface>'),
   modelRow('Custom Folder Model', 'GroundingDINO', 'groundingdino', 'dino.pth'),
   modelRow('Root Model', 'instantid', 'instantid/SDXL', 'ip-adapter.bin'),
   // upstream ships a few names twice with different files
   modelRow('Twice', 'upscale', 'default', 'twice-a.pth'),
   modelRow('Twice', 'upscale', 'default', 'twice-b.pth'),
]
const mirror: ManagerMirror = {
   plugins_byTitle: new Map(mirrorPlugins.map((p) => [p.title, p])),
   plugins_byFile: new Map(mirrorPlugins.map((p) => [p.files[0] ?? p.reference, p])),
   plugins_byNodeKey: new Map([['impact-pack.FaceDetailer', [plugin]]]),
   modelRows: mirrorModels,
}

// getmappings: a registered repo's url key replaced by its registry id, title_aux kept
const mappings: Record<string, [string[], { title_aux: string }]> = {
   'comfyui-impact-pack': [['FaceDetailer'], { title_aux: 'ComfyUI Impact Pack' }],
   'comfyui-cliption': [['CliptionNode'], { title_aux: 'Comfy Cliption' }],
   'https://github.com/someone/disabled-pack': [['DisabledNode'], { title_aux: 'Disabled Pack' }],
   'https://github.com/someone/missing-pack': [['MissingNode'], { title_aux: 'Missing Pack' }],
   'Cased-Pack': [['CasedNode'], { title_aux: 'Cased Pack' }],
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
   failMessages = ['Model installation error: boom']
   exitingWorker = false
   refuseBatch = false
   /** the install runs this many polls before it lands */
   drainAfterPolls = 0
   drainCalls = 0
   /** poll numbers (status and history GETs, from 1) whose request fails like a network blip */
   failPolls = new Set<number>()
   /** every poll from this one on fails: the host is gone */
   outageFrom: number | null = null
   pollCount = 0
   /** a queue/reset from another client right after our start: the task leaves with no result */
   wipeOnStart = false
   /** 4.x resolves the id we send through its own map and installs another pack that holds it */
   installsOtherPack = false
   coreFiles: Record<string, string[]> = { vae_approx: [], checkpoints: [], diffusers: [], loras: [] }

   constructor(public gen: ManagerGeneration | 'none') {}

   get pre(): string {
      return this.gen === 'v3' ? '' : '/v2'
   }

   drain(): void {
      if (this.neverDrains || !this.processing) return
      if (++this.drainCalls <= this.drainAfterPolls) return
      for (const item of this.queue) {
         const ok = this.outcome === 'success'
         if (ok && item.kind === 'model') this.onDisk.add(String(item.body.filename))
         if (ok && item.kind === 'plugin' && !this.installsOtherPack)
            this.installed[String(item.body.id)] = { cnr_id: String(item.body.id), aux_id: null, enabled: true }
         this.history[item.uiId] = {
            status: { status_str: ok ? 'success' : 'error', messages: ok ? [] : this.failMessages },
         }
      }
      this.queue = []
      this.processing = false
   }

   manager(times: { installTimeoutMs?: number; pollGraceMs?: number } = {}): ComfyManager {
      return new ComfyManager(
         { getServerHostHTTP: () => 'http://box:8188', fetch: (route, init) => this.serve(route, init) },
         { pollMs: 1, installTimeoutMs: 30, pollGraceMs: 10, ...times },
         () => mirror,
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
      // core ComfyUI, whatever the Manager
      if (is('GET', '/models')) return Response.json(Object.keys(this.coreFiles))
      if (method === 'GET' && route.startsWith('/models/')) {
         const files = this.coreFiles[decodeURIComponent(route.slice('/models/'.length))]
         // what the Manager downloaded lands on the core listing (every test model sits in vae_approx)
         const landed = route === '/models/vae_approx' ? [...this.onDisk] : []
         return files == null ? new Response('', { status: 404 }) : Response.json([...files, ...landed])
      }
      if (is('GET', '/v2/manager/version')) return g === 'v3' ? new Response('', { status: 404 }) : new Response('4.4')
      if (is('GET', '/manager/version')) return g === 'v3' ? new Response('V3.42') : new Response('', { status: 404 })
      if (is('GET', '/v2/manager/is_legacy_manager_ui') && g !== 'v3')
         return Response.json({ is_legacy_manager_ui: g === 'v4-legacy-ui' })
      if (g !== 'v4' && is('GET', `${pre}/externalmodel/getlist?mode=cache`))
         return Response.json({ models: [{ ...model, installed: this.onDisk.has(model.filename) ? 'True' : 'False' }] })
      if (g !== 'v4' && method === 'GET' && route.startsWith(`${pre}/customnode/getlist?`))
         return Response.json({ channel: 'default', node_packs: packs })
      if (is('GET', `${pre}/customnode/installed`)) return Response.json(this.installed)
      if (is('GET', `${pre}/customnode/getmappings?mode=cache`)) return Response.json(mappings)
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
         if (this.refuseBatch) {
            this.queue = []
            return Response.json({ failed: ['comfyui-impact-pack'] })
         }
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
      const isPoll =
         method === 'GET' && (route === `${pre}/manager/queue/status` || route.startsWith('/v2/manager/queue/history?'))
      if (isPoll) {
         this.pollCount++
         if (this.failPolls.has(this.pollCount) || (this.outageFrom != null && this.pollCount >= this.outageFrom))
            throw new TypeError('fetch failed')
      }
      if (is('POST', `${pre}/manager/queue/start`) && this.wipeOnStart) {
         this.queue = []
         return new Response('')
      }
      if (is('POST', `${pre}/manager/queue/start`)) {
         // the real 4.2.2 worker lingers 4 s after a drain, then exits: a start in that window answers
         // 201 "already running" and the task stays pending with no worker
         if (this.exitingWorker) {
            this.exitingWorker = false
            return new Response('', { status: 201 })
         }
         const started = !this.processing
         this.processing = true
         return new Response('', { status: started ? 200 : 201 })
      }
      if (is('GET', `${pre}/manager/queue/status`)) {
         this.drain()
         const pending = this.queue.length
         return Response.json({
            total_count: pending,
            done_count: 0,
            in_progress_count: 0,
            pending_count: pending,
            is_processing: this.processing,
         })
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

   it('4.x: a bare `failed` is the security gate, and the log says which settings it wants', async () => {
      // what a real 4.2.2 answers on a server listening beyond localhost with network_mode public
      const box = new FakeManager('v4')
      box.outcome = 'error'
      box.failMessages = ['failed']
      const r = await capturingErrors(() => box.manager().installModel(model))
      expect(r.value).toBe(false)
      expect(r.errors).toContain('the Manager reports error: failed')
      expect(r.errors).toContain('refused by its security policy')
      expect(r.errors).toContain('network_mode personal_cloud')
   })

   it('4.x: a start that lands while the worker exits leaves the task pending, so the client starts again', async () => {
      const box = new FakeManager('v4')
      box.exitingWorker = true
      expect(await box.manager().installModel(model)).toBe(true)
      expect(box.routes().filter((r) => r === 'POST /v2/manager/queue/start').length).toBe(2)
   })

   it('V3: the same race: idle with work queued is started again, not read as a failed install', async () => {
      const box = new FakeManager('v3')
      box.exitingWorker = true
      expect(await box.manager().installModel(model)).toBe(true)
      expect(box.routes().filter((r) => r === 'POST /manager/queue/start').length).toBe(2)
   })

   it('4.x: a task wiped from the queue with no result fails at once, not after the deadline', async () => {
      const box = new FakeManager('v4')
      box.wipeOnStart = true
      const manager = box.manager()
      manager.timing.installTimeoutMs = 5_000
      const t0 = Date.now()
      const r = await capturingErrors(() => manager.installModelOutcome(model))
      expect(r.value).toBe('failed')
      expect(Date.now() - t0).toBeLessThan(1_000)
      expect(r.errors).toContain('the task left the queue with no result')
   })

   it('a failed poll mid install is a blip: the wait goes on and the install lands (every generation)', async () => {
      for (const gen of ['v3', 'v4-legacy-ui', 'v4'] as const) {
         const box = new FakeManager(gen)
         box.drainAfterPolls = 4
         box.failPolls = new Set([2])
         // the budgets are wall clock: a 30 ms one ran out under a full parallel suite before the fourth poll, so a test
         // that waits for success gets budgets it never reaches; it still ends as soon as the install lands
         const r = await capturingErrors(() =>
            box.manager({ installTimeoutMs: 5_000, pollGraceMs: 5_000 }).installModel(model),
         )
         expect({ gen, ok: r.value }).toEqual({ gen, ok: true })
         expect(r.errors).toContain('poll failed, still waiting')
      }
   })

   it('a host gone for longer than pollGraceMs: the outcome is unknown, never failed, and the log says not to retry blind', async () => {
      const box = new FakeManager('v4')
      box.neverDrains = true
      box.outageFrom = 2
      const manager = box.manager()
      manager.timing.installTimeoutMs = 5_000
      const r = await capturingErrors(() => manager.installModelOutcome(model))
      expect(r.value).toBe('unknown')
      expect(r.errors).toContain('OUTCOME UNKNOWN')
      expect(r.errors).toContain('before installing again')
      expect(await new FakeManager('v4').manager().installModel(model)).toBe(true)
   })

   it('the deadline passing while the task still runs is unknown too', async () => {
      const box = new FakeManager('v3')
      box.neverDrains = true
      const r = await capturingErrors(() => box.manager().installModelOutcome(model))
      expect(r.value).toBe('unknown')
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

   it('4.x legacy ui: a refused batch names the ids and where the reason is (what a real 4.2.2 answers)', async () => {
      const box = new FakeManager('v4-legacy-ui')
      box.refuseBatch = true
      const r = await capturingErrors(() => box.manager().installPlugin(plugin))
      expect(r.value).toBe(false)
      expect(r.errors).toContain('POST /v2/manager/queue/batch refused ["comfyui-impact-pack"]')
      expect(r.errors).toContain('the batch reply carries ids only')
   })

   it('4.x: a success for an id that another pack holds is not this pack installed', async () => {
      const box = new FakeManager('v4')
      box.installsOtherPack = true
      const r = await capturingErrors(() => box.manager().installPluginOutcome(plugin))
      expect(r.value).toBe('failed')
      expect(r.errors).toContain('another pack holds the id "comfyui-impact-pack"')
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

   it('V3 entries carry the mirror title of their repo, so lookups by mirror title work', async () => {
      const manager = new FakeManager('v3').manager()
      manager.pluginList = await manager.fetchPlugins()
      expect(manager.getPluginStatus('Comfy Cliption' as never)).toBe('update-available')
   })
})

// the 4.x default ui serves no list: the installed view joins our mirror to what the host reports
describe('4.x default ui: the installed view', () => {
   const v4Box = (): FakeManager => {
      const box = new FakeManager('v4')
      box.installed = {
         // a registry archive install: registry id only, joined through the Manager's mappings
         'comfyui-impact-pack': { cnr_id: 'comfyui-impact-pack', aux_id: null, enabled: true },
         // the scan lowercases the registry id, the mappings keep the registry casing
         'cased-pack': { cnr_id: 'cased-pack', aux_id: null, enabled: true },
         // a git clone: joined by owner/repo
         'comfy-cliption': { cnr_id: '', aux_id: 'pharmapsychotic/comfy-cliption', enabled: true },
         'disabled-pack.disabled': { cnr_id: '', aux_id: 'someone/disabled-pack', enabled: false },
         // a git clone of a repo the mirror does not list: no mirror row, no effect
         PixelThing: { cnr_id: '', aux_id: 'someone/pixel-thing', enabled: true },
         // disabled and tied to nothing: whichever row it is, that row reads not-installed anyway
         'old-pack@1_0_0': { cnr_id: 'old-pack', aux_id: null, enabled: false },
      }
      box.coreFiles = {
         vae_approx: ['taef1_decoder.pth'],
         checkpoints: ['SD1.5\\sub.ckpt', 'other.safetensors'],
         diffusers: [],
         instantid: ['ip-adapter.bin'],
         upscale_models: ['twice-a.pth'],
      }
      return box
   }

   it('plugins: installed, disabled, missing, each with its status, never Update', async () => {
      const manager = v4Box().manager()
      manager.pluginList = await manager.fetchPlugins()
      expect(manager.getPluginStatus('ComfyUI Impact Pack' as never)).toBe('installed')
      expect(manager.getPluginStatus('Comfy Cliption' as never)).toBe('installed')
      expect(manager.getPluginStatus('Disabled Pack' as never)).toBe('not-installed')
      expect(manager.getPluginStatus('Missing Pack' as never)).toBe('not-installed')
      expect(manager.getPluginStatus('Unmapped Pack' as never)).toBe('not-installed')
      expect(manager.getPluginStatus('Cased Pack' as never)).toBe('installed')
      expect(manager.isPluginInstalled('ComfyUI Impact Pack' as never)).toBe(true)
      expect(manager.titlesOfAllInstalledPlugins.sort()).toEqual(
         ['ComfyUI Impact Pack', 'Comfy Cliption', 'Cased Pack'].sort(),
      )
      expect(manager.pluginList.custom_nodes.some((x) => x.installed === 'Update')).toBe(false)
   })

   it('a registry install nothing ties to a row: the rows it could be read unknown, the others stay decided', async () => {
      const box = v4Box()
      box.installed['mystery-pack'] = { cnr_id: 'mystery-pack', aux_id: null, enabled: true }
      const manager = box.manager()
      const r = await capturingErrors(() => manager.fetchPlugins())
      manager.pluginList = r.value
      expect(manager.getPluginStatus('Unmapped Pack' as never)).toBe('unknown')
      expect(manager.isPluginInstalled('Unmapped Pack' as never)).toBe(false)
      expect(manager.getPluginStatus('Missing Pack' as never)).toBe('not-installed')
      expect(manager.getPluginStatus('ComfyUI Impact Pack' as never)).toBe('installed')
      expect(r.errors).toContain('(mystery-pack): the mirror rows they could be read unknown')
   })

   it('models: installed, missing, in a sub folder, and the undecidable ones unknown', async () => {
      const manager = v4Box().manager()
      manager.modelList = await manager.fetchModels()
      expect(manager.getModelStatus('TAEF1 Decoder' as never)).toBe('installed')
      expect(manager.isModelInstalled('TAEF1 Decoder' as never)).toBe(true)
      expect(manager.getModelStatus('Missing Model' as never)).toBe('not-installed')
      expect(manager.getModelStatus('Sub Model' as never)).toBe('installed')
      expect(manager.getModelStatus('HF Model' as never)).toBe('unknown')
      expect(manager.getModelStatus('Custom Folder Model' as never)).toBe('unknown')
      // the Manager counts the folder root as installed too
      expect(manager.getModelStatus('Root Model' as never)).toBe('installed')
      // one file present, the other absent: the name alone cannot say
      expect(manager.getModelStatus('Twice' as never)).toBe('unknown')
   })

   it('reads only what the default ui and core serve, never the legacy lists', async () => {
      const box = v4Box()
      const manager = box.manager()
      await manager.fetchPluginsAndModels()
      expect(box.routes()).not.toContain('GET /v2/customnode/getlist')
      expect(box.routes()).not.toContain('GET /v2/externalmodel/getlist')
      expect(box.routes()).toContain('GET /v2/customnode/installed')
      expect(box.routes()).toContain('GET /v2/customnode/getmappings')
      expect(box.routes()).toContain('GET /models/vae_approx')
   })

   it('a host whose answer has the wrong shape throws, never a guessed list', async () => {
      const box = v4Box()
      box.installed = { broken: { enabled: 'yes' } } as never
      await expect(box.manager().fetchPlugins()).rejects.toThrow(/GET \/v2\/customnode\/installed: /)
   })
})

describe('requirements: undecided is not missing', () => {
   const v4Manager = async (): Promise<ComfyManager> => {
      const box = new FakeManager('v4')
      box.installed = { 'comfyui-impact-pack': { cnr_id: 'comfyui-impact-pack', aux_id: null, enabled: true } }
      box.coreFiles = { vae_approx: ['taef1_decoder.pth'], checkpoints: [], diffusers: [] }
      const manager = box.manager()
      await manager.fetchPluginsAndModels()
      return manager
   }

   it('a requirement the lists cannot decide is undecided, never missing, and matches with a warning', async () => {
      const manager = await v4Manager()
      const reqs = [
         { type: 'modelInManager', modelName: 'HF Model' },
         { type: 'modelInManager', modelName: 'Missing Model' },
         { type: 'modelInManager', modelName: 'TAEF1 Decoder' },
         { type: 'customNodesByTitle', title: 'ComfyUI Impact Pack' },
         { type: 'customNodesByNodeKey', nodeName: 'impact-pack.FaceDetailer' },
         { type: 'customNodesByTitle', title: 'Missing Pack' },
      ] as Requirements[]
      const check = manager.checkRequirements(reqs)
      expect(check.missing).toEqual([reqs[1], reqs[5]] as Requirements[])
      expect(check.undecided).toEqual([reqs[0]] as Requirements[])
      const r = await capturingErrors(async () =>
         manager.matchRequirements([reqs[0], reqs[2], reqs[3]] as Requirements[]),
      )
      expect(r.value).toBe(true)
      expect(r.errors).toContain('HF Model')
      expect(manager.matchRequirements([reqs[1]] as Requirements[])).toBe(false)
   })

   it('before the lists are fetched every requirement is undecided, none missing', () => {
      const manager = new FakeManager('v4').manager()
      const check = manager.checkRequirements([
         { type: 'modelInManager', modelName: 'TAEF1 Decoder' },
      ] as Requirements[])
      expect(check).toEqual({
         missing: [],
         undecided: [{ type: 'modelInManager', modelName: 'TAEF1 Decoder' }],
      } as never)
   })
})
