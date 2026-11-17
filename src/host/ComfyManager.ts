/** 🔶 NAMING DISCLAIMER: I call a "custom node package" => "PLUGIN" */

import { type ArkErrors, type Type, type } from 'arktype'
import { nanoid } from 'nanoid'
import type { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'
import type { KnownModel_Name } from 'src/manager/generated/KnownModel_Name.ts'
import {
   attributePacks,
   buildModelView,
   buildPluginView,
   type InstalledPacks,
   InstalledPacks_ark,
   type ManagerMirror,
   modelFolders,
   type PackMappings,
   PackMappings_ark,
   packIsInstalled,
   repoPath,
} from 'src/manager/installedView.ts'
import type { ComfyManagerAPIFetchPolicy } from 'src/manager/types/ComfyManagerAPIFetchPolicy.ts'
import {
   type ComfyManagerAPIModelList,
   ComfyManagerAPIModelList_ark,
} from 'src/manager/types/ComfyManagerAPIModelList.ts'
import {
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
import type { PluginInstallStatus, Requirements } from 'src/host/Requirements.ts'

/**
 * the three ComfyUI-Manager servers in the field (agent/architecture.md, Manager HTTP client):
 * `v3` the legacy custom node (bare routes), `v4-legacy-ui` the pip package under
 * `--enable-manager-legacy-ui` (/v2), `v4` the pip package with its default ui (/v2, no lists)
 */
export type ManagerGeneration = 'v3' | 'v4-legacy-ui' | 'v4'
export type ManagerApi = { generation: ManagerGeneration; version: string }

/** install waits poll the queue; `pollGraceMs`: how long the poll survives a host that does not answer */
export type ManagerTiming = { pollMs: number; installTimeoutMs: number; pollGraceMs: number }
export const MANAGER_TIMING: ManagerTiming = { pollMs: 1000, installTimeoutMs: 60 * 60_000, pollGraceMs: 120_000 }

/** `unknown`: we lost sight of the task, the Manager may still be installing (agent/architecture.md) */
export type InstallOutcome = 'installed' | 'failed' | 'unknown'

/** an install the host refused or reported failed: ends the wait at once */
class InstallFailed extends Error {}
/** we lost sight of the task: the outcome is not known */
class OutcomeUnknown extends Error {}

type ManagerRoute =
   | '/manager/version'
   | '/manager/reboot'
   | '/manager/terminal'
   | '/customnode/getlist'
   | '/externalmodel/getlist'
   | '/customnode/installed'
   | '/customnode/getmappings'
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

/** everything that differs between generations beyond a route's spelling */
type ManagerStrategy = {
   fetchPlugins: (mode: ComfyManagerAPIFetchPolicy, skipUpdate: boolean) => Promise<ComfyManagerAPIPluginList>
   fetchModels: () => Promise<ComfyManagerAPIModelList>
   /** resolves with the id the host installs by, when it is not the pack's own row */
   enqueuePlugin: (plugin: ComfyManagerPluginInfo, uiId: string) => Promise<string | undefined>
   /** wait until the queued task ran: resolves when it succeeded, throws with why when not */
   settle: (what: string, uiId: string, landed: () => Promise<boolean | null>, sentId?: string) => Promise<void>
}

const QueueStatus_ark = type({
   is_processing: 'boolean',
   'pending_count?': 'number',
   'total_count?': 'number',
   'done_count?': 'number',
})
const TaskHistory_ark = type({
   history: { 'status?': { status_str: 'string', 'messages?': 'string[]' }, 'result?': 'string' },
})
const ModelFolders_ark = type('string[]')

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export class ComfyManager {
   constructor(
      public host: {
         getServerHostHTTP: () => string
         fetch: (route: string, init?: RequestInit, p?: { apiPrefix?: boolean }) => Promise<Response>
      },
      public timing: ManagerTiming = { ...MANAGER_TIMING },
      /** the mirror the lists are joined to; the registry by default */
      public mirror: () => ManagerMirror = () => comfyts.registry,
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
      if (NOT_SERVED[api.generation].includes(route))
         throw new Error(`🔴 ComfyUI-Manager ${api.version} (${api.generation}) does not serve ${route}`)
      return `${api.generation === 'v3' ? '' : '/v2'}${route}${query}`
   }

   /** the one place the generations differ beyond a route's spelling */
   private strategy = (api: ManagerApi): ManagerStrategy => {
      switch (api.generation) {
         case 'v3':
            return {
               fetchPlugins: (mode, skipUpdate) => this.listedPlugins(api, mode, skipUpdate),
               fetchModels: () => this.listedModels(api),
               enqueuePlugin: (plugin, uiId) =>
                  this.enqueueListedPlugin(api, plugin, uiId, (body) =>
                     this.post(this.route(api, '/manager/queue/install'), body),
                  ),
               settle: (what, _uiId, landed) => this.settleByDrain(api, what, landed),
            }
         case 'v4-legacy-ui':
            return {
               fetchPlugins: (mode, skipUpdate) => this.listedPlugins(api, mode, skipUpdate),
               fetchModels: () => this.listedModels(api),
               enqueuePlugin: (plugin, uiId) =>
                  this.enqueueListedPlugin(api, plugin, uiId, async (body) => {
                     const route = this.route(api, '/manager/queue/batch')
                     const res = await this.post(route, { install: [body] })
                     const failed = typeof res === 'object' && res != null && 'failed' in res ? res.failed : null
                     if (Array.isArray(failed) && failed.length > 0)
                        throw new Error(
                           `POST ${route} refused ${JSON.stringify(failed)}: the batch reply carries ids only, ` +
                              `the ComfyUI console says why (a 4.x security policy refusal is the usual one)`,
                        )
                  }),
               settle: (what, _uiId, landed) => this.settleByDrain(api, what, landed),
            }
         case 'v4':
            return {
               fetchPlugins: () => this.installedPluginView(api),
               fetchModels: () => this.installedModelView(),
               enqueuePlugin: (plugin, uiId) => this.enqueuePluginTask(api, plugin, uiId),
               settle: (what, uiId, landed, sentId) => this.settleByHistory(api, what, uiId, landed, sentId),
            }
      }
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

   /** what the host has of our model mirror; a model absent from the list reads `unknown` */
   fetchModels = async (): Promise<ComfyManagerAPIModelList> => {
      return this.strategy(await this.api()).fetchModels()
   }

   fetchLogs = (): Promise<any> => {
      return this.getJSON<unknown>('/internal/logs')
   }

   /** true only for a KNOWN install: false is "not known to be installed" (missing OR undecided), see `getModelStatus` */
   isModelInstalled = (name: KnownModel_Name): boolean => {
      return this.modelList?.models.some((x) => x.name === name && x.installed === 'True') ?? false
   }

   modelsBeeingInstalled = new Set<KnownModel_Name>()

   /** queue the install, wait until the Manager ran it; true only once the model is verified installed (`installModelOutcome` tells failed from unknown) */
   installModel = async (model: ComfyManagerModelInfo): Promise<boolean> =>
      (await this.installModelOutcome(model)) === 'installed'

   installModelOutcome = async (model: ComfyManagerModelInfo): Promise<InstallOutcome> => {
      this.modelsBeeingInstalled.add(model.name)
      try {
         return await this.runInstall(`model "${model.name}"`, {
            enqueue: async (api, uiId) => {
               const body = { ...model, ui_id: uiId, client_id: this.clientId }
               await this.post(this.route(api, '/manager/queue/install_model'), body)
            },
            landed: async (s) => {
               // the triple the Manager's own install whitelist matches on
               const row = (await s.fetchModels()).models.find(
                  (x) => x.filename === model.filename && x.save_path === model.save_path && x.base === model.base,
               )
               return row == null ? null : row.installed === 'True'
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

   /** true only for a KNOWN install: false is "not known to be installed" (missing OR undecided), see `getPluginStatus` */
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

   // REQUIREMENTS: undecided is not missing --------------------------------------------
   /** one requirement against the fetched lists; `unknown` when they cannot say, null when the mirror does not know it */
   requirementStatus = (req: Requirements): PluginInstallStatus | null => {
      const mirror = this.mirror()
      const packs = ((): readonly ComfyManagerPluginInfo[] | null => {
         if (req.type === 'customNodesByNodeKey') return mirror.plugins_byNodeKey.get(req.nodeName) ?? []
         if (req.type === 'customNodesByTitle') return [mirror.plugins_byTitle.get(req.title)].filter((x) => x != null)
         if (req.type === 'customNodesByURI') return [mirror.plugins_byFile.get(req.uri)].filter((x) => x != null)
         return null
      })()
      if (packs == null) return req.type === 'modelInManager' ? this.getModelStatus(req.modelName) : null
      if (packs.length === 0) return req.type === 'customNodesByNodeKey' ? 'unknown' : null
      const statuses = packs.map((x) => this.getPluginStatus(x.title))
      if (statuses.some((x) => x === 'installed' || x === 'update-available')) return 'installed'
      return statuses.every((x) => x === 'not-installed') ? 'not-installed' : 'unknown'
   }

   /** `missing`: known not installed, the only requirements an install flow may queue; `undecided`: the lists cannot say */
   checkRequirements = (requirements: Requirements[]): { missing: Requirements[]; undecided: Requirements[] } => {
      const out: { missing: Requirements[]; undecided: Requirements[] } = { missing: [], undecided: [] }
      for (const req of requirements) {
         if (req.optional) continue
         const status = this.requirementStatus(req)
         if (status === 'not-installed') out.missing.push(req)
         else if (status === 'unknown' || status === 'error') out.undecided.push(req)
      }
      return out
   }

   /** false only when a requirement is known missing; an undecided one passes with a warning */
   matchRequirements = (requirements: Requirements[]): boolean => {
      const check = this.checkRequirements(requirements)
      if (check.undecided.length > 0)
         logError(
            `requirements the host lists cannot decide, read as present: ${check.undecided.map((r) => JSON.stringify(r)).join(', ')}` +
               (this.pluginList == null || this.modelList == null
                  ? ' (the lists are not fetched: call fetchPluginsAndModels)'
                  : ''),
         )
      return check.missing.length === 0
   }

   /** the host's plugin list in the public `custom_nodes` shape, titled like our mirror; absent = `unknown` */
   fetchPlugins = async (
      /** @default: 'cache' */
      mode: ComfyManagerAPIFetchPolicy = 'cache',
      /** @default: true */
      skipUpdate: boolean = true,
   ): Promise<ComfyManagerAPIPluginList> => {
      return this.strategy(await this.api()).fetchPlugins(mode, skipUpdate)
   }

   /** queue the install, wait until the Manager ran it; true only once the pack is verified installed (`installPluginOutcome` tells failed from unknown) */
   installPlugin = async (plugin: ComfyManagerPluginInfo): Promise<boolean> =>
      (await this.installPluginOutcome(plugin)) === 'installed'

   installPluginOutcome = async (plugin: ComfyManagerPluginInfo): Promise<InstallOutcome> => {
      return this.runInstall(`plugin "${plugin.title}"`, {
         enqueue: (api, uiId) => this.strategy(api).enqueuePlugin(plugin, uiId),
         landed: async (_s, api) => {
            const data = await this.installedData(api)
            return packIsInstalled(attributePacks(data.installed, data.mappings), plugin)
         },
      })
   }

   // LIST BUILDERS: one per source, picked by the strategy -------------------------------
   /** the Manager's own getlist (v3, v4 legacy ui), normalized */
   private listedPlugins = async (
      api: ManagerApi,
      mode: ComfyManagerAPIFetchPolicy,
      skipUpdate: boolean,
   ): Promise<ComfyManagerAPIPluginList> => {
      const raw = await this.fetchPluginWire(api, mode, skipUpdate)
      if (!('node_packs' in raw)) return raw
      const titleByRepo = new Map<string, KnownComfyPluginTitle>()
      for (const p of this.mirror().plugins_byTitle.values())
         for (const f of p.files) titleByRepo.set(repoPath(f), p.title)
      return {
         chanel: raw.channel,
         custom_nodes: Object.values(raw.node_packs).map((p) => {
            const repo = p.files?.[0]
            return {
               title: (repo != null ? titleByRepo.get(repoPath(repo)) : undefined) ?? p.title,
               installed: p.state !== 'enabled' ? 'False' : p['update-state'] === 'true' ? 'Update' : 'True',
            }
         }),
      }
   }

   private fetchPluginWire = async (
      api: ManagerApi,
      mode: ComfyManagerAPIFetchPolicy,
      skipUpdate: boolean,
   ): Promise<ComfyManagerAPIPackList | ComfyManagerAPIPluginList> => {
      const query = `?mode=${mode}${skipUpdate ? '&skip_update=true' : ''}`
      const json: unknown = await this.getJSON(this.route(api, '/customnode/getlist', query))
      if (typeof json === 'object' && json != null && 'custom_nodes' in json)
         return softValidate(ComfyManagerAPIPluginList_ark, json)
      return softValidate(ComfyManagerAPIPackList_ark, json)
   }

   private listedModels = async (api: ManagerApi): Promise<ComfyManagerAPIModelList> => {
      return this.getJSON(this.route(api, '/externalmodel/getlist', '?mode=cache'), ComfyManagerAPIModelList_ark)
   }

   /** what is installed, as the Manager scans it, joined through its own registry id mappings */
   private installedData = async (api: ManagerApi): Promise<{ installed: InstalledPacks; mappings: PackMappings }> => {
      const [installed, mappings] = await Promise.all([
         this.getValid(this.route(api, '/customnode/installed'), InstalledPacks_ark),
         this.getValid(this.route(api, '/customnode/getmappings', '?mode=cache'), PackMappings_ark),
      ])
      return { installed, mappings }
   }

   /** v4 serves no list: our mirror against what is installed */
   private installedPluginView = async (api: ManagerApi): Promise<ComfyManagerAPIPluginList> => {
      const view = buildPluginView({ mirror: this.mirror(), ...(await this.installedData(api)) })
      if (view.unattributed.length > 0)
         logError(
            `ComfyUI-Manager ${api.version} reports installed packs no mirror row can be tied to ` +
               `(${view.unattributed.join(', ')}): the mirror rows they could be read unknown`,
         )
      return view.list
   }

   /** v4 serves no model list: core ComfyUI's model folders against our mirror */
   private installedModelView = async (): Promise<ComfyManagerAPIModelList> => {
      const models = this.mirror().modelRows
      const registered = new Set(await this.getValid('/models', ModelFolders_ark))
      const folders = [...modelFolders(models)].filter((f) => registered.has(f))
      const lists = await Promise.all(
         folders.map(
            async (f) => [f, await this.getValid(`/models/${encodeURIComponent(f)}`, ModelFolders_ark)] as const,
         ),
      )
      return buildModelView({ models, files: new Map(lists) })
   }

   // INSTALL FLOW: enqueue → start → settle -------------------------------------------
   /** v3 and v4 legacy ui: the Manager's own list row for the pack, sent like its own ui does */
   private enqueueListedPlugin = async (
      api: ManagerApi,
      plugin: ComfyManagerPluginInfo,
      uiId: string,
      send: (body: Record<string, unknown>) => Promise<unknown>,
   ): Promise<undefined> => {
      const url = plugin.files[0] ?? plugin.reference
      const list = await this.fetchPluginWire(api, 'cache', true)
      if (!('node_packs' in list))
         throw new Error(`ComfyUI-Manager ${api.version} lists packs in the pre-V3 shape and has no queue install`)
      const found = Object.entries(list.node_packs).find(([, p]) =>
         (p.files ?? []).some((f) => repoPath(f) === repoPath(url)),
      )
      if (found == null)
         throw new Error(
            `${url} is not in the Manager's own list (channel ${list.channel}), so it refuses to install it`,
         )
      const [key, row] = found
      await send({
         ...row,
         id: row.id ?? key,
         channel: list.channel,
         mode: 'cache',
         ui_id: uiId,
         skip_post_install: false,
      })
      return undefined
   }

   /** v4: no list to take a row from, so the pack goes by repo name at nightly; resolves with that id */
   private enqueuePluginTask = async (
      api: ManagerApi,
      plugin: ComfyManagerPluginInfo,
      uiId: string,
   ): Promise<string> => {
      const url = plugin.files[0] ?? plugin.reference
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
      return id
   }

   /** v4: the task's own history entry says how it ended; the end state confirms a success */
   private settleByHistory = async (
      api: ManagerApi,
      what: string,
      uiId: string,
      landed: () => Promise<boolean | null>,
      sentId?: string,
   ): Promise<void> => {
      const route = this.route(api, '/manager/queue/history', `?ui_id=${encodeURIComponent(uiId)}`)
      const readEntry = async () => (await this.getValid(route, TaskHistory_ark)).history.status ?? null
      const entry = await this.waitFor(what, async () => {
         const status = await readEntry()
         if (status != null) return status
         if ((await this.restartIdleQueue(api)) !== 'drained') return null
         // the worker writes the entry before it lets go of the task: read once more to close that race
         const late = await readEntry()
         if (late != null) return late
         throw new InstallFailed(
            'the task left the queue with no result (a queue/reset from the Manager UI or another client removes it)',
         )
      })
      if (entry.status_str === 'success' || entry.status_str === 'skip') {
         if ((await this.endState(landed)) !== false) return
         throw new InstallFailed(
            sentId != null
               ? `the Manager reported success, but this pack does not read installed: another pack holds the id "${sentId}" it installs by`
               : 'the Manager reported success, but it does not read installed afterwards',
         )
      }
      const messages = entry.messages ?? []
      // the 4.x worker answers a bare `failed` from its security gate only (4.2.2 and 4.4 source)
      const gate =
         messages.length === 1 && messages[0] === 'failed'
            ? ': refused by its security policy, which allows installs only with security_level normal or below ' +
              'AND either ComfyUI listening on localhost or network_mode personal_cloud (the ComfyUI console names the rule)'
            : ''
      throw new InstallFailed(`the Manager reports ${entry.status_str}: ${messages.join(' | ')}${gate}`)
   }

   /**
    * a worker lingers a few seconds after a drain, then exits; a start in that window answers 201
    * "already running" and leaves the new task pending with no worker (seen live on 4.2.2, same loop
    * in V3 and 4.4). So an idle queue that still holds work is started again.
    */
   private restartIdleQueue = async (api: ManagerApi): Promise<'running' | 'restarted' | 'drained'> => {
      const status = await this.getValid(this.route(api, '/manager/queue/status'), QueueStatus_ark)
      if (status.is_processing) return 'running'
      const waiting = status.pending_count ?? (status.total_count ?? 0) - (status.done_count ?? 0)
      if (waiting <= 0) return 'drained'
      await this.post(this.route(api, '/manager/queue/start'))
      return 'restarted'
   }

   /** v3, v4 legacy ui: no per item result over http, so wait for the drain and look at the end state */
   private settleByDrain = async (
      api: ManagerApi,
      what: string,
      landed: () => Promise<boolean | null>,
   ): Promise<void> => {
      await this.waitFor(what, async () => ((await this.restartIdleQueue(api)) === 'drained' ? true : null))
      const state = await this.endState(landed)
      if (state === true) return
      if (state === null)
         throw new OutcomeUnknown('the queue drained, but the lists cannot say whether it is installed')
      throw new InstallFailed(
         `the Manager queue drained but it is not installed; ComfyUI-Manager ${api.version} ` +
            `reports why only over its websocket (cm-queue-status) and in the ComfyUI console`,
      )
   }

   /** the end state after the task ran: a host that does not answer here leaves the outcome unknown */
   private endState = async (landed: () => Promise<boolean | null>): Promise<boolean | null> => {
      try {
         return await landed()
      } catch (exception) {
         throw new OutcomeUnknown(`the task ran, but its end state could not be read: ${errorText(exception)}`)
      }
   }

   private runInstall = async (
      what: string,
      p: {
         /** resolves with the id the host installs by, when it is not the pack's own row */
         enqueue: (api: ManagerApi, uiId: string) => Promise<string | undefined>
         /** the end state: true installed, false not, null the lists cannot say */
         landed: (s: ManagerStrategy, api: ManagerApi) => Promise<boolean | null>
      },
   ): Promise<InstallOutcome> => {
      const host = this.host.getServerHostHTTP()
      try {
         const api = await this.api()
         const s = this.strategy(api)
         const uiId = nanoid()
         const sentId = await p.enqueue(api, uiId)
         await this.post(this.route(api, '/manager/queue/start'))
         await s.settle(what, uiId, () => p.landed(s, api), sentId)
         logSuccess(`${what} installed`)
         return 'installed'
      } catch (exception) {
         if (exception instanceof OutcomeUnknown) {
            logError(
               `${what}: OUTCOME UNKNOWN on ${host}: ${exception.message}. The Manager may still be installing it: ` +
                  `refetch the list (fetchModels / fetchPlugins) and read its status before installing again, ` +
                  `a blind retry queues a second download`,
            )
            return 'unknown'
         }
         logError(`${what}: install failed on ${host}: ${errorText(exception)}`)
         return 'failed'
      }
   }

   /**
    * poll until `check` gives a value. A failed request is a blip: logged, and the poll goes on until
    * `timing.pollGraceMs` passes without one good answer. Giving up, or the deadline, is an UNKNOWN
    * outcome (the task may still run); only an `InstallFailed` from `check` ends the wait as a failure.
    */
   private waitFor = async <T>(what: string, check: () => Promise<T | null>): Promise<T> => {
      const deadline = Date.now() + this.timing.installTimeoutMs
      let lastAnswer = Date.now()
      for (;;) {
         try {
            const value = await check()
            lastAnswer = Date.now()
            if (value != null) return value
         } catch (exception) {
            if (exception instanceof InstallFailed) throw exception
            if (Date.now() - lastAnswer >= this.timing.pollGraceMs)
               throw new OutcomeUnknown(
                  `the host gave no answer for ${this.timing.pollGraceMs} ms (manager.timing.pollGraceMs), last: ${errorText(exception)}`,
               )
            logError(`${what}: poll failed, still waiting: ${errorText(exception)}`)
         }
         if (Date.now() >= deadline)
            throw new OutcomeUnknown(
               `still running after ${this.timing.installTimeoutMs} ms (manager.timing.installTimeoutMs)`,
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

   /** a GET whose shape the decision depends on: a mismatch throws instead of lying */
   private getValid = async <OUT>(route: string, schema: (json: unknown) => OUT | ArkErrors): Promise<OUT> => {
      const res = schema(await this.getJSON(route))
      if (res instanceof type.errors) throw new Error(`GET ${route}: ${res.summary}`)
      return res
   }
}
