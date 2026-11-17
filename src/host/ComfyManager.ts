/** 🔶 NAMING DISCLAIMER: I call a "custom node package" => "PLUGIN" */

import { type Type, type } from 'arktype'
import { nanoid } from 'nanoid'
import type { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'
import type { KnownModel_Name } from 'src/manager/generated/KnownModel_Name.ts'
import type { ComfyManagerAPIFetchPolicy } from 'src/manager/types/ComfyManagerAPIFetchPolicy.ts'
import {
   type ComfyManagerAPIModelList,
   ComfyManagerAPIModelList_ark,
} from 'src/manager/types/ComfyManagerAPIModelList.ts'
import {
   type ComfyManagerAPIPack,
   type ComfyManagerAPIPackList,
   ComfyManagerAPIPackList_ark,
   type ComfyManagerAPIPluginList,
   ComfyManagerAPIPluginList_ark,
} from 'src/manager/types/ComfyManagerAPIPluginList.ts'
import type { ComfyManagerModelInfo } from 'src/manager/types/ComfyManagerModelInfo.ts'
import type { ComfyManagerPluginInfo } from 'src/manager/types/ComfyManagerPluginInfo.ts'
import type { Maybe } from 'src/types/index.ts'
import { logError, logSuccess } from 'src/utils/log.ts'
import { softValidate } from 'src/utils/softValidate.ts'
import type { PluginInstallStatus } from 'src/host/Requirements.ts'

/**
 * the three ComfyUI-Manager servers in the field (agent/architecture.md, Manager HTTP client):
 * `v3` the legacy custom node (bare routes), `v4-legacy-ui` the pip package under
 * `--enable-manager-legacy-ui` (/v2), `v4` the pip package with its default ui (/v2, no lists)
 */
export type ManagerGeneration = 'v3' | 'v4-legacy-ui' | 'v4'
export type ManagerApi = { generation: ManagerGeneration; version: string }

/** install waits poll the queue; tests pass milliseconds */
export type ManagerTiming = { pollMs: number; installTimeoutMs: number }
export const MANAGER_TIMING: ManagerTiming = { pollMs: 1000, installTimeoutMs: 60 * 60_000 }

type ManagerRoute =
   | '/manager/version'
   | '/manager/reboot'
   | '/manager/terminal'
   | '/customnode/getlist'
   | '/externalmodel/getlist'
   | '/customnode/installed'
   | '/manager/queue/install'
   | '/manager/queue/batch'
   | '/manager/queue/task'
   | '/manager/queue/install_model'
   | '/manager/queue/start'
   | '/manager/queue/status'
   | '/manager/queue/history'

/** what each generation does NOT serve (history means the `?ui_id=` form) */
const NOT_SERVED: Record<ManagerGeneration, ManagerRoute[]> = {
   v3: ['/manager/queue/batch', '/manager/queue/task', '/manager/queue/history'],
   'v4-legacy-ui': ['/manager/queue/install', '/manager/queue/task', '/manager/queue/history', '/manager/terminal'],
   v4: [
      '/customnode/getlist',
      '/externalmodel/getlist',
      '/manager/queue/install',
      '/manager/queue/batch',
      '/manager/terminal',
   ],
}

const QueueStatus_ark = type({ is_processing: 'boolean' })
const TaskHistory_ark = type({
   history: { 'status?': { status_str: 'string', 'messages?': 'string[]' }, 'result?': 'string' },
})
const InstalledPacks_ark = type.Record(
   'string',
   type({ 'cnr_id?': 'string | null', 'aux_id?': 'string | null', enabled: 'boolean' }),
)

/** `https://github.com/Owner/Repo.git/` → `owner/repo`: the Manager's aux id and our match key */
const repoPath = (url: string): string =>
   url
      .toLowerCase()
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
      .split('/')
      .slice(-2)
      .join('/')

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export class ComfyManager {
   constructor(
      public host: {
         getServerHostHTTP: () => string
         fetch: (route: string, init?: RequestInit, p?: { apiPrefix?: boolean }) => Promise<Response>
      },
      public timing: ManagerTiming = { ...MANAGER_TIMING },
   ) {}

   get registry(): ComfyRegistry {
      return comfyts.registry
   }

   /** identifies install tasks of this client in the Manager queue (4.x requires one) */
   readonly clientId: string = `comfy-ts-${nanoid(8)}`

   // generation ------------------------------------------------------------------------
   private _api: Promise<ManagerApi> | null = null

   /** which Manager answers: probed once, remembered, forgotten on failure and on reboot */
   api = (): Promise<ManagerApi> => {
      if (this._api == null) {
         const probe = this.probeApi()
         this._api = probe
         probe.catch(() => {
            if (this._api === probe) this._api = null
         })
      }
      return this._api
   }

   private probeApi = async (): Promise<ManagerApi> => {
      const v4 = await this.host.fetch('/v2/manager/version')
      if (v4.ok) {
         const version = (await v4.text()).trim()
         const ui = await this.host.fetch('/v2/manager/is_legacy_manager_ui')
         if (!ui.ok) {
            logError(
               `ComfyUI-Manager ${version}: GET /v2/manager/is_legacy_manager_ui → ${ui.status}, assuming the default ui`,
            )
            return { generation: 'v4', version }
         }
         const flag: unknown = await ui.json()
         const legacy =
            typeof flag === 'object' &&
            flag != null &&
            'is_legacy_manager_ui' in flag &&
            flag.is_legacy_manager_ui === true
         return { generation: legacy ? 'v4-legacy-ui' : 'v4', version }
      }
      const v3 = await this.host.fetch('/manager/version')
      if (v3.ok) return { generation: 'v3', version: (await v3.text()).trim() }
      throw new Error(
         `🔴 no ComfyUI-Manager answers at ${this.host.getServerHostHTTP()} ` +
            `(GET /v2/manager/version → ${v4.status}, GET /manager/version → ${v3.status})`,
      )
   }

   /** the one place a Manager route gets its generation's spelling */
   private route = (api: ManagerApi, route: ManagerRoute, query: string = ''): string => {
      if (NOT_SERVED[api.generation].includes(route)) {
         const hint =
            route === '/customnode/getlist' || route === '/externalmodel/getlist'
               ? ': start ComfyUI with --enable-manager-legacy-ui to get the lists'
               : ''
         throw new Error(`🔴 ComfyUI-Manager ${api.version} (${api.generation}) does not serve ${route}${hint}`)
      }
      return `${api.generation === 'v3' ? '' : '/v2'}${route}${query}`
   }

   // -----------
   configureLogging = async (mi: boolean): Promise<string> => {
      const api = await this.api()
      const route = this.route(api, '/manager/terminal', `?mode=${mi}`)
      const response = await this.host.fetch(route)
      const text = await response.text()
      if (!response.ok) throw new Error(`🔴 GET ${route} → ${response.status} ${text}`)
      return text
   }

   // utils ------------------------------------------------------------------------------
   getModelInfoFinalFilePath = (mi: ComfyManagerModelInfo): string => {
      return comfyts.registry.getModelInfoFinalFilePath(mi)
   }

   waitForHostToBeBackOnline(maxAttempt: 10): Promise<true> {
      return new Promise<true>((yes, no) => {
         let attempt = 0
         let abortCtrl: AbortController
         const interval = setInterval(async () => {
            attempt++
            if (attempt > maxAttempt) {
               console.log(`   - failure`)
               clearInterval(interval)
               no()
            }
            if (abortCtrl) abortCtrl.abort()
            abortCtrl = new AbortController()
            try {
               console.log(`   - trying...`)
               await this.host.fetch('/', { signal: abortCtrl.signal }, { apiPrefix: false })
               clearInterval(interval)
               yes(true)
            } catch {
               /* empty */
            }
         }, 1000)
      })
   }

   // actions ---------------------------------------------------------------------------
   rebootComfyUIAndUpdateHostPluginsAndModelsAfter10Seconds(): Promise<void> {
      // 🔴 bad code
      setTimeout(() => void this.fetchPluginsAndModels(), 10_000)
      return this.restartComfyUI()
   }

   /**
    * reboot the ComfyUI process (ComfyUI-Manager).
    *
    * The server dies mid-request, so a DROPPED CONNECTION is the success shape and the only
    * one most callers ever see. A 404 is not: the route is POST from Manager V3 on, and a GET
    * there answers 404 while the process keeps running. Both verbs are tried so a pre-V3
    * Manager still reboots, and anything that is neither a disconnect nor a 404 throws with
    * what the host actually said. The process may come back with another Manager, so the
    * remembered generation is dropped.
    */
   restartComfyUI = async (): Promise<void> => {
      const api = await this.api()
      this._api = null
      const route = this.route(api, '/manager/reboot')
      const refusals: string[] = []
      for (const method of ['POST', 'GET'] as const) {
         let response: Response
         try {
            response = await this.host.fetch(route, { method })
         } catch {
            return // connection gone: the process is going down, which is what we asked for
         }
         if (response.ok) return
         refusals.push(`${method} → ${response.status}`)
         // only a missing route is worth retrying with the other verb
         if (response.status !== 404) break
      }
      throw new Error(
         `🔴 ${this.host.getServerHostHTTP()} refused to reboot (${route}: ${refusals.join(', ')}) — ` +
            `ComfyUI-Manager ${api.version} is not there any more, or its reboot route moved again`,
      )
   }

   // LISTS ----------------------------------------------------------------------------
   fetchPluginsAndModels = async (): Promise<void> => {
      const [_pluginList, _modelList] = await Promise.all([this.fetchPlugins(), this.fetchModels()])
      this.pluginList = _pluginList
      this.modelList = _modelList
   }

   modelList: Maybe<ComfyManagerAPIModelList> = null

   fetchModels = async (): Promise<ComfyManagerAPIModelList> => {
      const api = await this.api()
      return this.getJSON(this.route(api, '/externalmodel/getlist', '?mode=cache'), ComfyManagerAPIModelList_ark)
   }

   fetchLogs = (): Promise<any> => {
      return this.getJSON<unknown>('/internal/logs')
   }

   isModelInstalled = (name: KnownModel_Name): boolean => {
      return this.modelList?.models.some((x) => x.name === name && x.installed === 'True') ?? false
   }

   modelsBeeingInstalled = new Set<KnownModel_Name>()

   /** queue the install, wait until the Manager ran it; true only once the model is verified installed */
   installModel = async (model: ComfyManagerModelInfo): Promise<boolean> => {
      this.modelsBeeingInstalled.add(model.name)
      try {
         return await this.runInstall(`model "${model.name}"`, {
            enqueue: async (api, uiId) => {
               const body = { ...model, ui_id: uiId, client_id: this.clientId }
               await this.post(this.route(api, '/manager/queue/install_model'), body)
            },
            landed: async (api) => {
               const list = await this.getJSON(
                  this.route(api, '/externalmodel/getlist', '?mode=cache'),
                  ComfyManagerAPIModelList_ark,
               )
               // the triple the Manager's own install whitelist matches on
               const row = list.models.find(
                  (x) => x.filename === model.filename && x.save_path === model.save_path && x.base === model.base,
               )
               return row?.installed === 'True'
            },
         })
      } finally {
         this.modelsBeeingInstalled.delete(model.name)
      }
   }

   getModelStatus = (modelName: KnownModel_Name): PluginInstallStatus => {
      if (this.modelList == null) return 'unknown'
      const entry = this.modelList?.models.find((x) => x.name === modelName)
      const status = ((): PluginInstallStatus => {
         if (!entry) return 'unknown'
         if (entry?.installed === 'False') return 'not-installed'
         if (entry?.installed === 'True') return 'installed'
         if (entry?.installed === 'Update') return 'update-available'
         return 'error'
      })()
      return status
   }

   // PLUGINS (A.K.A. Custom nodes) ----------------------------------------------------------------------------
   /**
    * you need to call `fetchPluginList()` to populate this field
    */
   pluginList: Maybe<ComfyManagerAPIPluginList> = null // hasModel = async (model: ModelInfo) => {

   get titlesOfAllInstalledPlugins(): KnownComfyPluginTitle[] {
      return (
         this.pluginList?.custom_nodes //
            .filter((x) => x.installed === 'True')
            .map((x) => x.title) ?? []
      )
   }

   isPluginInstalled = (title: KnownComfyPluginTitle): boolean => {
      if (!this.pluginList || !this.pluginList.custom_nodes) return false
      return this.pluginList.custom_nodes.some((x) => x.title === title && x.installed === 'True') ?? false
   }

   getPluginStatus = (title: KnownComfyPluginTitle): PluginInstallStatus => {
      if (this.pluginList == null) return 'unknown'
      const entry = this.pluginList?.custom_nodes.find((x) => x.title === title)
      const status = ((): PluginInstallStatus => {
         if (!entry) return 'unknown'
         if (entry?.installed === 'False') return 'not-installed'
         if (entry?.installed === 'True') return 'installed'
         if (entry?.installed === 'Update') return 'update-available'
         return 'error'
      })()
      return status
   }

   /** the Manager's plugin list, in the public `custom_nodes` shape whatever the wire shape */
   fetchPlugins = async (
      /** @default: 'cache' */
      mode: ComfyManagerAPIFetchPolicy = 'cache',
      /** @default: true */
      skipUpdate: boolean = true,
   ): Promise<ComfyManagerAPIPluginList> => {
      const raw = await this.fetchPluginWire(mode, skipUpdate)
      if (!('node_packs' in raw)) return raw
      return {
         chanel: raw.channel,
         custom_nodes: Object.values(raw.node_packs).map((p) => ({
            title: p.title,
            installed: p.state !== 'enabled' ? 'False' : p['update-state'] === 'true' ? 'Update' : 'True',
         })),
      }
   }

   private fetchPluginWire = async (
      mode: ComfyManagerAPIFetchPolicy,
      skipUpdate: boolean,
   ): Promise<ComfyManagerAPIPackList | ComfyManagerAPIPluginList> => {
      const api = await this.api()
      const query = `?mode=${mode}${skipUpdate ? '&skip_update=true' : ''}`
      const json: unknown = await this.getJSON(this.route(api, '/customnode/getlist', query))
      if (typeof json === 'object' && json != null && 'custom_nodes' in json)
         return softValidate(ComfyManagerAPIPluginList_ark, json)
      return softValidate(ComfyManagerAPIPackList_ark, json)
   }

   /** queue the install, wait until the Manager ran it; true only once the pack is verified installed */
   installPlugin = async (plugin: ComfyManagerPluginInfo): Promise<boolean> => {
      const url = plugin.files[0] ?? plugin.reference
      let key: string | null = null
      return this.runInstall(`plugin "${plugin.title}"`, {
         enqueue: async (api, uiId) => {
            if (api.generation === 'v4') {
               const id = repoPath(url).split('/').pop() ?? url
               const params = {
                  id,
                  version: 'nightly',
                  selected_version: 'nightly',
                  repository: url,
                  mode: 'cache',
                  channel: 'default',
               }
               await this.post(this.route(api, '/manager/queue/task'), {
                  ui_id: uiId,
                  client_id: this.clientId,
                  kind: 'install',
                  params,
               })
               return
            }
            const list = await this.fetchPluginWire('cache', true)
            if (!('node_packs' in list))
               throw new Error(
                  `ComfyUI-Manager ${api.version} lists packs in the pre-V3 shape and has no queue install`,
               )
            const found = Object.entries(list.node_packs).find(([, p]) =>
               (p.files ?? []).some((f) => repoPath(f) === repoPath(url)),
            )
            if (found == null)
               throw new Error(
                  `${url} is not in the Manager's own list (channel ${list.channel}), so it refuses to install it`,
               )
            const row: ComfyManagerAPIPack = found[1]
            key = row.id ?? found[0]
            const body = {
               ...row,
               id: key,
               channel: list.channel,
               mode: 'cache',
               ui_id: uiId,
               skip_post_install: false,
            }
            if (api.generation === 'v3') {
               await this.post(this.route(api, '/manager/queue/install'), body)
               return
            }
            const res: unknown = await this.post(this.route(api, '/manager/queue/batch'), { install: [body] })
            const failed = typeof res === 'object' && res != null && 'failed' in res ? res.failed : null
            if (Array.isArray(failed) && failed.length > 0)
               throw new Error(`POST ${this.route(api, '/manager/queue/batch')} refused ${JSON.stringify(failed)}`)
         },
         landed: async (api) => {
            const json = await this.getJSON(this.route(api, '/customnode/installed'))
            const installed = InstalledPacks_ark(json)
            if (installed instanceof type.errors) throw new Error(`GET customnode/installed: ${installed.summary}`)
            // a registered pack answers with its cnr id, a git clone with its owner/repo
            return Object.values(installed).some(
               (p) =>
                  p.enabled &&
                  ((key != null && p.cnr_id?.toLowerCase() === key.toLowerCase()) ||
                     (p.aux_id != null && repoPath(p.aux_id) === repoPath(url))),
            )
         },
      })
   }

   // INSTALL FLOW: enqueue → start → wait → outcome -----------------------------------
   private runInstall = async (
      what: string,
      p: {
         enqueue: (api: ManagerApi, uiId: string) => Promise<void>
         /** the end state, for the generations that report no per item result over http */
         landed: (api: ManagerApi) => Promise<boolean>
      },
   ): Promise<boolean> => {
      try {
         const api = await this.api()
         const uiId = nanoid()
         await p.enqueue(api, uiId)
         await this.post(this.route(api, '/manager/queue/start'))
         if (api.generation === 'v4') {
            const route = this.route(api, '/manager/queue/history', `?ui_id=${encodeURIComponent(uiId)}`)
            const entry = await this.waitFor(what, async () => {
               const history = TaskHistory_ark(await this.getJSON(route))
               if (history instanceof type.errors) throw new Error(`GET ${route}: ${history.summary}`)
               return history.history.status ?? null
            })
            if (entry.status_str !== 'success' && entry.status_str !== 'skip')
               throw new Error(`the Manager reports ${entry.status_str}: ${(entry.messages ?? []).join(' | ')}`)
         } else {
            const route = this.route(api, '/manager/queue/status')
            await this.waitFor(what, async () => {
               const status = QueueStatus_ark(await this.getJSON(route))
               if (status instanceof type.errors) throw new Error(`GET ${route}: ${status.summary}`)
               return status.is_processing ? null : true
            })
            if (!(await p.landed(api)))
               throw new Error(
                  `the Manager queue drained but it is not installed; ComfyUI-Manager ${api.version} ` +
                     `reports why only over its websocket (cm-queue-status) and in the ComfyUI console`,
               )
         }
         logSuccess(`${what} installed`)
         return true
      } catch (exception) {
         logError(`${what}: install failed on ${this.host.getServerHostHTTP()}: ${errorText(exception)}`)
         return false
      }
   }

   /** poll until `check` gives a value, never past `timing.installTimeoutMs` */
   private waitFor = async <T>(what: string, check: () => Promise<T | null>): Promise<T> => {
      const deadline = Date.now() + this.timing.installTimeoutMs
      for (;;) {
         const value = await check()
         if (value != null) return value
         if (Date.now() >= deadline)
            throw new Error(
               `${what} still running after ${this.timing.installTimeoutMs} ms (manager.timing.installTimeoutMs)`,
            )
         await new Promise((resolve) => setTimeout(resolve, this.timing.pollMs))
      }
   }

   // --------------------------------------------------------------
   /** json POST (the Manager's csrf guard refuses simple form types); the reply json, or null when empty */
   private post = async (route: string, body?: unknown): Promise<unknown> => {
      const response = await this.host.fetch(route, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`POST ${route} → ${response.status} ${text}`.trim())
      if (text === '') return null
      try {
         return JSON.parse(text)
      } catch {
         return text
      }
   }

   private getJSON = async <OUT = unknown>(route: string, validator?: Type<OUT>): Promise<OUT> => {
      const response = await this.host.fetch(route)
      if (!response.ok) throw new Error(`GET ${route} → ${response.status} ${await response.text()}`.trim())
      const jsonResult = await response.json()
      if (validator) return softValidate(validator, jsonResult)
      // wire tolerance (agent/coding.md): unvalidated endpoints return unknown-shaped json
      return jsonResult as OUT
   }
}
