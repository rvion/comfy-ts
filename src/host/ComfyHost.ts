import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { type } from 'arktype'
import type { MessageEvent } from 'ws'
import type { KnownComfyPluginTitle } from 'src/manager/generated/KnownComfyPluginTitle.ts'
import type { KnownComfyPluginURL } from 'src/manager/generated/KnownComfyPluginURL.ts'
import type { ComfyManagerPluginInfo } from 'src/manager/types/ComfyManagerPluginInfo.ts'
import type { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { ComfyApiJson } from 'src/sdk-generator/comfy-api-json.ts'
import { parseWorkflowJson } from 'src/litegraph/normalizeWorkflow.ts'
import { parseBinaryWsFrame } from 'src/runner/wsBinaryFrame.ts'
import { convertLiteGraphToPrompt } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'
import { asComfyWorkflowID, ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import {
   type ComfyStatusData,
   type LogEntry,
   type PromptID,
   type PromptRelated_WsMsg,
   type WsMsg,
   WsMsg_ark,
   WsMsgLogsData_ark,
} from 'src/runner/ComfyWsApi.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { type ComfySchemaJSON, ComfySchemaJSON_ark } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'
import type { EmbeddingName } from 'src/sdk-generator/comfyui-types.ts'
import { type AbsolutePath, type Maybe, type number_Timestamp, type Tagged } from 'src/types/index.ts'
import { exhaust } from 'src/utils/exhaust.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { printArkResultInConsole } from 'src/utils/printArkResultInConsole.ts'
import { readableStringify } from 'src/utils/stringifyReadable.ts'
import { logError as toastError, logInfo } from 'src/utils/log.ts'
import { writeFileAsync } from 'src/utils/writeFile.ts'
import type { ComfyInstallType } from 'src/host/ComfyInstallType.ts'
import { ComfyManager } from 'src/host/ComfyManager.ts'
import { ComfyUploader } from 'src/host/ComfyUploader.ts'
import { type ParsedHostBase, parseHostBase, renderHttpBase, renderWsUrl } from 'src/host/hostUrl.ts'
import type { Requirements } from 'src/host/Requirements.ts'
import { ResilientWebSocketClient } from 'src/host/ResilientWebsocket.ts'
import { DefinedWorkflow, type DefineWorkflowSpec } from 'src/vars/DefinedWorkflow.ts'
import type { VarsSpec } from 'src/vars/ComfyVars.ts'

export type ComfyHostID = Tagged<string, { HostID: true }>
export type ComfyHostData = {
   id: string

   /** full base url as pasted from a provider (https://cloud.comfy.org,
    * https://xxx.modal.run, http://192.168.1.5:8188/comfy).
    * Exactly ONE of url OR the legacy host+port (+https?) spelling. */
   url?: string
   host?: string
   port?: number
   https?: boolean

   /** sent as X-API-Key on every request AND the ws upgrade.
    * NEVER persist the value: read it from an env var (e.g. COMFY_CLOUD_API_KEY) */
   apiKey?: string
   /** default true. false = never write sdk.d.ts to .comfy-ts/hosts/<id>/ —
    * schema updates stay in-memory. The comfy-cloud example sets false: its sdk
    * home is the COMMITTED examples/comfy-cloud/sdk.d.ts (gen:sdk:cloud), and a
    * second copy under .comfy-ts/hosts/ would double-declare the globals. */
   sdkAutoWrite?: boolean
   /** extra headers merged into every request + the ws upgrade (Modal-style auth pairs) */
   headers?: Record<string, string>

   // for extra features using path manipulation
   installType?: ComfyInstallType

   // misc
   onWsMessageAny?: (e: MessageEvent) => void
   onWsMessageArrayBuffer?: (e: ArrayBuffer) => void
   onWsMessageJSON?: (e: WsMsg) => void
}

export type ConnectOptions = {
   /** 'auto' (default): reuse cache when fresh · 'refresh': always fetch · 'cache': never fetch */
   schema?: 'auto' | 'refresh' | 'cache'
   /** max cache age for 'auto' (default 24h) */
   maxAgeMs?: number
}

// biome-ignore format: misc
type SchemaUpdateResult = Maybe<{ type: 'success' } | { type: 'error'; error: unknown }>

type ServerLog = {
   at: string
   content: string
   id: number
}

/** auth failure with a SPECIFIC meaning (per the Comfy Cloud error table):
 * 401 invalid/missing key · 402 insufficient credits · 429 subscription inactive
 * (or plain rate limiting on non-cloud hosts). The key value never appears here. */
export class ComfyHostAuthError extends Error {
   constructor(
      public code: 401 | 402 | 429,
      public hostId: string,
      message: string,
   ) {
      super(message)
      this.name = 'ComfyHostAuthError'
   }
}

export class ComfyHost<ID extends string = string> {
   // ----- misc paths where we'll store host-related files -----
   cacheFolder: AbsolutePath

   comfyJSONPath: AbsolutePath
   embeddingsPath: AbsolutePath
   sdkDTSPath: AbsolutePath

   /** the schema instance with all methods to interract with the host schema */
   schema: ComfySchema
   uploader = new ComfyUploader(this)

   /** parsed ONCE from data (url-first or legacy host/port/https) — the url ground truth */
   readonly base: ParsedHostBase

   constructor(public data: ComfyHostData & { id: ID }) {
      this.base = parseHostBase(this.data)

      /** folder where file related to the host config will be cached */
      this.cacheFolder = comfyts.resolveFromHosts(this.data.id)

      // create the folder if it does not exist
      const exists = existsSync(this.cacheFolder)
      if (!exists) {
         console.log('🟢 creating folder', this.cacheFolder)
         mkdirSync(this.cacheFolder, { recursive: true })
      }

      this.comfyJSONPath = comfyts.resolve(this.cacheFolder, `object_info.json`)
      this.embeddingsPath = comfyts.resolve(this.cacheFolder, `embeddings.json`)
      this.sdkDTSPath = comfyts.resolve(this.cacheFolder, `sdk.d.ts`)

      /** create a new schema */
      this.schema = new ComfySchema({ embeddings: [], spec: {} })
   }

   /** helper to check if your host have whatever it needs to run your workflow */
   matchRequirements = (requirements: Requirements[]): boolean => {
      const repo = comfyts.registry
      for (const req of requirements) {
         if (req.optional) continue
         if (req.type === 'customNodesByNodeKey') {
            const plugins: ComfyManagerPluginInfo[] = repo.plugins_byNodeKey.get(req.nodeName) ?? []
            if (!plugins.find((i) => this.manager.isPluginInstalled(i.title))) {
               // console.log(`[❌ A] ${JSON.stringify(req)} NOT MATCHED`)
               return false
            }
         } else if (req.type === 'customNodesByTitle') {
            const plugin: ComfyManagerPluginInfo | undefined = repo.plugins_byTitle.get(req.title)
            if (plugin == null) continue
            if (!this.manager.isPluginInstalled(plugin.title)) {
               // console.log(`[❌ B] ${JSON.stringify(req)} NOT MATCHED`)
               return false
            }
         } else if (req.type === 'customNodesByURI') {
            const plugin: ComfyManagerPluginInfo | undefined = repo.plugins_byFile.get(req.uri)
            if (plugin == null) continue
            if (!this.manager.isPluginInstalled(plugin.title)) {
               // console.log(`[❌ C] ${JSON.stringify(req)} NOT MATCHED`)
               return false
            }
         } else if (req.type === 'modelInManager') {
            if (!this.manager.isModelInstalled(req.modelName)) {
               // console.log(`[❌ D] ${JSON.stringify(req)} NOT MATCHED`)
               return false
            }
         } else {
            // exhaust(req.type)
         }
      }
      return true
   }

   // ----- Rotating srever logs -----

   /** server sent by the comfy-manager plugin */
   readonly serverLogs: ServerLog[] = []

   /** if true, request ComfyUI to forward logs */
   private wantLog: boolean = true

   /** maximum amount of logs to keep in memory */
   readonly maxLogs: number = 200

   /** last log id received */
   private logId: number = 0

   /** toggle server log forwarding so comfy-ts can  */
   toggleServerLogs = (): Promise<unknown> => {
      this.wantLog = !this.wantLog
      return this.manager.configureLogging(this.wantLog)
   }

   addLog = (content: string): void => {
      if (this.serverLogs.length > this.maxLogs) this.serverLogs.shift()
      const d = new Date().toISOString().slice(11, 19)
      this.serverLogs.push({ content, id: this.logId++, at: d })
   }

   // ----- Misc helpers if you work with a local Comfy -----

   /** root install of ComfyUI on the host filesystem */
   get absolutePathToComfyUI(): Maybe<string> {
      return this.data.installType?.absolutePathToComfyRoot
   }

   // ----- Misc helpers if you work with a local Comfy -----

   get manager(): ComfyManager {
      const value = new ComfyManager(this)
      Object.defineProperty(this, 'manager', { value })
      return value
   }

   // INIT -----------------------------------------------------------------------------
   installCustomNodeByFile = async (customNodeFile: KnownComfyPluginURL): Promise<boolean> => {
      const manager = comfyts.registry
      const plugin: ComfyManagerPluginInfo | undefined = manager.plugins_byFile.get(customNodeFile)
      if (plugin == null) throw new Error(`Unknown custom node for file: "${customNodeFile}"`)
      return this.manager.installPlugin(plugin)
   }

   installCustomNodeByTitle = async (customNodeTitle: KnownComfyPluginTitle): Promise<boolean> => {
      const manager = comfyts.registry
      const plugin: ComfyManagerPluginInfo | undefined = manager.plugins_byTitle.get(customNodeTitle)
      if (plugin == null) throw new Error(`Unknown custom node for title: "${customNodeTitle}"`)
      return this.manager.installPlugin(plugin)
   }

   installCustomNode = async (customNode: ComfyManagerPluginInfo): Promise<boolean> => {
      return this.manager.installPlugin(customNode)
   }

   // URLS -----------------------------------------------------------------------------
   getServerHostHTTP(): string {
      return renderHttpBase(this.base)
   }

   getWSUrl = (): string => {
      return renderWsUrl(this.base)
   }

   // HTTP -----------------------------------------------------------------------------
   /** extra headers + X-API-Key, for every http request AND the ws upgrade */
   private authHeaders(): Record<string, string> {
      const out: Record<string, string> = {}
      if (this.data.headers != null) Object.assign(out, this.data.headers)
      if (this.data.apiKey != null) out['X-API-Key'] = this.data.apiKey
      return out
   }

   /** remembered /api-prefix verdict for this host; null until first probed */
   private _apiPrefix: boolean | null = null

   /**
    * the ONE http path to this host: joins basePath, injects X-API-Key + extra
    * headers, prefers `/api<route>` (required by Comfy Cloud, canonical since
    * custom nodes hijack bare routes) with a bare-route fallback on 404/405 for
    * old local servers (winner memoized; the other spelling is still retried
    * when the memo misses — mixed servers exist, e.g. /internal is bare-only).
    * Auth failures throw a typed ComfyHostAuthError instead of generic noise.
    * `p.apiPrefix: false` opts a route out of the prefix game entirely.
    */
   fetch = async (route: string, init: RequestInit = {}, p: { apiPrefix?: boolean } = {}): Promise<Response> => {
      const base = this.getServerHostHTTP()
      const headers = new Headers(init.headers)
      for (const [k, v] of Object.entries(this.authHeaders())) headers.set(k, v)
      const send = (prefixed: boolean): Promise<Response> =>
         fetch(`${base}${prefixed ? '/api' : ''}${route}`, { ...init, headers })
      const missed = (res: Response): boolean => res.status === 404 || res.status === 405

      let res: Response
      if (p.apiPrefix === false) {
         res = await send(false)
      } else if (this._apiPrefix != null) {
         res = await send(this._apiPrefix)
         if (missed(res)) {
            const alt = await send(!this._apiPrefix)
            if (!missed(alt)) res = alt
         }
      } else {
         res = await send(true)
         if (missed(res)) {
            const bare = await send(false)
            if (!missed(bare)) {
               this._apiPrefix = false
               res = bare
            }
         } else {
            this._apiPrefix = true
         }
      }
      this.throwOnAuthError(res, route)
      return res
   }

   /**
    * binary download path: Comfy Cloud answers `/api/view` with a 302 to a
    * temporary signed URL. fetch only auto-strips Authorization/cookies on
    * cross-origin redirects — a custom X-API-Key WOULD be forwarded to the
    * storage host — so we follow the Location manually with a CLEAN fetch.
    */
   fetchFile = async (route: string): Promise<Response> => {
      const res = await this.fetch(route, { redirect: 'manual' })
      if (res.status >= 300 && res.status < 400) {
         const location = res.headers.get('location')
         if (location == null)
            throw new Error(`GET ${route} on host '${this.data.id}' redirected (${res.status}) without a Location`)
         void res.body?.cancel()
         return fetch(new URL(location, this.getServerHostHTTP()))
      }
      return res
   }

   private throwOnAuthError(res: Response, route: string): void {
      if (res.status === 401)
         throw new ComfyHostAuthError(
            401,
            this.data.id,
            this.data.apiKey != null
               ? `host '${this.data.id}': 401 on ${route} — API key invalid or expired`
               : `host '${this.data.id}': 401 on ${route} — host requires authentication, no apiKey configured`,
         )
      if (res.status === 402)
         throw new ComfyHostAuthError(
            402,
            this.data.id,
            `host '${this.data.id}': 402 on ${route} — insufficient credits`,
         )
      if (res.status === 429)
         throw new ComfyHostAuthError(
            429,
            this.data.id,
            `host '${this.data.id}': 429 on ${route} — subscription inactive or rate limited`,
         )
   }

   // LOGS -----------------------------------------------------------------------------
   schemaRetrievalLogs: string[] = []

   resetLog = (): void => {
      this.schemaRetrievalLogs.splice(0, this.schemaRetrievalLogs.length)
   }

   // STARTING -----------------------------------------------------------------------------
   get isConnected(): boolean {
      return this.ws?.isOpen ?? false
   }

   workflow = (p: { id?: string } = {}): ComfyWorkflow<ID> => {
      return new ComfyWorkflow(this, {
         metadata: {},
         id: p.id ? asComfyWorkflowID(p.id) : undefined,
      })
   }

   /**
    * define a re-runnable workflow: `build` re-executes with the current var
    * values on every run(). The standard contract for tweak & re-run drivers
    * (scripts, the TUI).
    */
   defineWorkflow = <V extends VarsSpec>(spec: DefineWorkflowSpec<ID, V>): DefinedWorkflow<ID, V> => {
      return new DefinedWorkflow(this, spec)
   }

   /**
    * import a workflow.json (litegraph format) as a live, editable workflow.
    * Accepts unknown: the JSON is ark-validated + normalized (parseWorkflowJson)
    * before conversion — invalid documents throw WorkflowNormalizeError.
    */
   importWorkflowJson = (json: unknown, p: { id?: string } = {}): ComfyWorkflow<ID> => {
      const canonical = parseWorkflowJson(json)
      const apiJson = convertLiteGraphToPrompt(this.schema, canonical)
      return this.importApiJson(apiJson, p)
   }

   /** import an api.json (ComfyUI prompt format) as a live, editable workflow */
   importApiJson = (json: ComfyApiJson, p: { id?: string } = {}): ComfyWorkflow<ID> => {
      const wf = new ComfyWorkflow(this, {
         apiJson: json,
         metadata: {},
         id: p.id ? asComfyWorkflowID(p.id) : undefined,
      })
      wf.onUpdate(null, wf.data) // hydrate ComfyNode instances from the json
      return wf
   }

   private _ready: Promise<void> | null = null
   private _readyResolve: (() => void) | null = null
   private _readyReject: ((e: unknown) => void) | null = null
   private _schemaStrategy: NonNullable<ConnectOptions['schema']> = 'auto'
   private _schemaMaxAgeMs: number = 24 * 3600_000

   /**
    * open the websocket; resolves once connected AND the schema is loaded.
    * Schema strategy:
    *  - 'auto' (default): reuse .comfy-ts/ cache when younger than maxAgeMs — fast starts
    *  - 'refresh': always fetch object_info + regen the sdk
    *  - 'cache': never fetch (throws when no cache exists)
    */
   connect = (p: ConnectOptions = {}): Promise<void> => {
      if (this._ready == null) {
         this._schemaStrategy = p.schema ?? 'auto'
         this._schemaMaxAgeMs = p.maxAgeMs ?? 24 * 3600_000
         this._ready = new Promise<void>((res, rej) => {
            this._readyResolve = res
            this._readyReject = rej
         })
         this.initWebsocket()
      }
      return this._ready
   }

   /** close the websocket (e.g. to let a script exit) */
   disconnect = (): void => {
      this.ws?.disconnectPermanently()
      this.ws = null
      this._ready = null
   }

   private markReady(): void {
      this._readyResolve?.()
      this._readyResolve = null
      this._readyReject = null
   }

   private markFailed(error: unknown): void {
      // reject the pending connect() so callers fail fast instead of hanging
      this._readyReject?.(error)
      this._readyResolve = null
      this._readyReject = null
   }

   private async writeSDKToDisk(): Promise<void> {
      if (this.data.sdkAutoWrite === false) return
      const comfySchemaTs = this.schema.codegenDTS({ hostId: this.data.id })
      // skip the 4MB write when nothing changed (fast re-connects)
      if (existsSync(this.sdkDTSPath) && readFileSync(this.sdkDTSPath, 'utf-8') === comfySchemaTs) return
      await writeFileAsync(this.sdkDTSPath, comfySchemaTs, 'utf-8')
   }

   private shouldUseSchemaCache(): boolean {
      if (this._schemaStrategy === 'refresh') return false
      const exists = existsSync(this.comfyJSONPath)
      if (this._schemaStrategy === 'cache') {
         if (!exists) throw new Error(`connect({schema:'cache'}) but no cache at ${this.comfyJSONPath}`)
         return true
      }
      if (!exists) return false
      const ageMs = Date.now() - statSync(this.comfyJSONPath).mtimeMs
      return ageMs < this._schemaMaxAgeMs
   }

   // WEBSCKET -----------------------------------------------------------------------------
   /**
    * will be created only after we've loaded cnfig file
    * so we don't attempt to connect to some default server
    * */
   ws: Maybe<ResilientWebSocketClient> = null

   /** resolves once the server assigned us a session id (first ws 'status' message) */
   private _sessionResolve: (() => void) | null = null
   private waitForSession(timeoutMs: number = 5000): Promise<void> {
      if (this.comfySessionId !== 'temp') return Promise.resolve()
      return new Promise<void>((res) => {
         this._sessionResolve = res
         // some setups never send a sid — proceed after the timeout, loudly
         setTimeout(() => {
            if (this._sessionResolve != null) {
               console.error(
                  `🔴 no session id from ${this.data.id} after ${timeoutMs}ms — executions may not route back`,
               )
               this._sessionResolve = null
               res()
            }
         }, timeoutMs).unref?.()
      })
   }

   private initWebsocket(): ResilientWebSocketClient {
      logInfo(`[👢] WEBSOCKET: starting client to ComfyUI host ${this.data.id}`)
      this.ws = new ResilientWebSocketClient({
         onConnectOrReconnect: async (): Promise<void> => {
            logInfo(`[👢] WEBSOCKET: connected to ComfyUI host ${this.data.id}`)
            if (this.shouldUseSchemaCache()) {
               try {
                  await this.loadSchemaFromCache()
                  // the server routes execution events by client_id: without the
                  // session id from the first 'status' message, prompts we POST
                  // would report to nobody. The slow fetch path masked this race.
                  await this.waitForSession()
                  this.markReady()
                  return
               } catch (error) {
                  console.error(`🔴 schema cache load failed, falling back to fetch`, extractErrorMessage(error))
               }
            }
            await this.fetchAndUpdateSchema()
            await this.waitForSession()
            this.markReady()
         },
         onMessage: (e: MessageEvent): void => this.onMessage(e),
         url: () => this.getWSUrl(),
         // auth rides the upgrade HEADERS, never the query string
         headers: () => this.authHeaders(),
         onClose: (): void => {
            logInfo(`[👢] WEBSOCKET: closed connection to ComfyUI host ${this.data.id}`)
         },
      })
      return this.ws
   }

   _isUpdatingSchema: boolean = false
   get isUpdatingSchema(): boolean {
      return this._isUpdatingSchema
   }
   set isUpdatingSchema(v: boolean) {
      this._isUpdatingSchema = v
   }

   schemaUpdateResult: SchemaUpdateResult = null

   private _schemaFromCache: Promise<void> | null = null

   /** load the schema from .comfy-ts/hosts/<id>/ without connecting (offline workflows, fast starts).
    * idempotent like connect(): N co-imported modules parse the ~4MB cache once.
    * A MISSING cache degrades LOUDLY to the base types instead of failing the
    * module import (a fresh consumer project has no cache yet — the bundled
    * examples must still open in the TUI; run() fetches the real schema through
    * connect() anyway). Not memoized in that case, so a later gen/connect retries. */
   loadSchemaFromCache(): Promise<void> {
      if (this._schemaFromCache == null && !existsSync(this.comfyJSONPath)) {
         toastError(
            `no schema cache for host '${this.data.id}' at ${this.comfyJSONPath} — continuing with base types (no node/model unions); run \`comfy-ts gen --id ${this.data.id} --host <url>\` or connect() once to create it`,
         )
         return Promise.resolve()
      }
      this._schemaFromCache ??= (async (): Promise<void> => {
         const object_info_json = comfyts.readJSON_<ComfySchemaJSON>(this.comfyJSONPath)
         const embeddings_json = comfyts.readJSON_<string[]>(this.embeddingsPath, [])

         // update schema
         this.schema.update({ spec: object_info_json, embeddings: embeddings_json })
         this.schema.RUN_BASIC_CHECKS()

         // the on-disk sdk was generated from this same cache — only write when missing
         if (!existsSync(this.sdkDTSPath)) await this.writeSDKToDisk()
      })().catch((e: unknown) => {
         this._schemaFromCache = null // a missing cache must stay retryable (e.g. after gen:sdk)
         throw e
      })
      return this._schemaFromCache
   }

   /** POST a JSON route through host.fetch (/api preferred, bare fallback) */
   private postJSON_ = async (route: string, body: unknown): Promise<void> => {
      const res = await this.fetch(route, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`POST ${route} failed on ${this.getServerHostHTTP()}: ${res.status}`)
   }

   /** drop every PENDING prompt from the server queue (the running one keeps going) */
   clearQueue = (): Promise<void> => {
      return this.postJSON_('/queue', { clear: true })
   }

   /** interrupt the CURRENTLY RUNNING prompt */
   interrupt = (): Promise<void> => {
      return this.postJSON_('/interrupt', {})
   }

   // SERVER LOGS ----------------------------------------------------------------------
   // /internal routes are served bare (no /api prefix, no custom-node hijacks)

   /** the server's recent console buffer (entries are write CHUNKS, not lines) */
   fetchRawLogs = async (): Promise<{ entries: LogEntry[] }> => {
      const res = await this.fetch('/internal/logs/raw', {}, { apiPrefix: false })
      if (!res.ok) throw new Error(`GET /internal/logs/raw failed: ${res.status}`)
      const json: unknown = await res.json()
      // wire tolerance (agent/coding.md cast #4): soft-validate, log, still cast
      const checked = WsMsgLogsData_ark(json)
      if (checked instanceof type.errors) {
         console.log(`[🔴] /!\\ /internal/logs/raw payload does not match schema.`)
         printArkResultInConsole(checked)
      }
      return json as { entries: LogEntry[] }
   }

   /** (un)subscribe THIS session to ws 'logs' messages — per-sid server state,
    * must be re-sent after every reconnect (see onSession) */
   subscribeLogs = async (p: { enabled: boolean; clientId: string }): Promise<void> => {
      const res = await this.fetch(
         '/internal/logs/subscribe',
         {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: p.enabled, clientId: p.clientId }),
         },
         { apiPrefix: false },
      )
      if (!res.ok) throw new Error(`PATCH /internal/logs/subscribe failed: ${res.status}`)
   }

   /** GET a JSON route through host.fetch (/api preferred, bare fallback) */
   private fetchJSON_ = async <T>(route: string): Promise<T> => {
      const base = this.getServerHostHTTP()
      const res = await this.fetch(route)
      if (!res.ok) throw new Error(`GET ${route} failed on ${base}: ${res.status}`)
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('json'))
         throw new Error(`GET ${route} on ${base} answered '${contentType || 'no content-type'}' instead of json`)
      return (await res.json()) as T
   }

   /** retrieve the comfy spec from the schema*/
   fetchAndUpdateSchema = async (): Promise<void> => {
      try {
         this.isUpdatingSchema = true
         // 1 ------------------------------------
         // download object_info (prefer /api/*: custom nodes hijack bare routes,
         // e.g. lora-manager serves HTML at /embeddings)
         const object_info_json = await this.fetchJSON_<{ [key: string]: ComfySchemaJSON[string] }>('/object_info')
         const object_info_str = readableStringify(object_info_json, 4)
         void writeFileAsync(this.comfyJSONPath, object_info_str, 'utf-8')
         // use ark to check if payload match the type, and display errors if not
         const res = ComfySchemaJSON_ark(object_info_json)
         if (res instanceof type.errors) {
            printArkResultInConsole(res)
         }

         // 2 ------------------------------------
         // download embeddings
         const embeddings_json = await this.fetchJSON_<EmbeddingName[]>('/embeddings').catch(
            () => [] as EmbeddingName[],
         )
         void writeFileAsync(this.embeddingsPath, JSON.stringify(embeddings_json), 'utf-8')

         // 3 ------------------------------------
         // update schema
         this.schema.update({ spec: object_info_json, embeddings: embeddings_json })
         this.schema.RUN_BASIC_CHECKS()

         // 3 ------------------------------------
         // regen sdk
         await this.writeSDKToDisk()
         this.isUpdatingSchema = false
         this.schemaUpdateResult = { type: 'success' }
      } catch (error) {
         this.isUpdatingSchema = false
         this.schemaUpdateResult = { type: 'error', error: error }

         console.error(error)
         console.error('🔴 FAILURE TO GENERATE the typed sdk', extractErrorMessage(error))

         const schemaExists = existsSync(this.sdkDTSPath)
         if (!schemaExists) await this.writeSDKToDisk()
         this.markFailed(error)
      } finally {
         this.isUpdatingSchema = false
      }
   }

   /** executions we started */
   executions: Map<PromptID, ComfyExecution> = new Map()

   /** buffer in case we receive packets out of order */
   _pendingMsgs = new Map<PromptID, PromptRelated_WsMsg[]>()

   /** the active prompt currently running on this host */
   private activePromptID: PromptID | null = null

   /** method to either execute or buffer the incoming message */
   routeOrBuffer(prompt_id: PromptID, msg: PromptRelated_WsMsg): void {
      this.activePromptID = prompt_id
      const prompt = this.executions.get(prompt_id)

      // case 1. no prompt yet => just store the messages
      if (prompt == null) {
         const msgs = this._pendingMsgs.get(prompt_id)
         if (msgs) msgs.push(msg)
         else this._pendingMsgs.set(prompt_id, [msg])
         return
      }
      // case 2. prompt exists => send the messages
      prompt.onPromptRelatedMessage(msg)
   }

   /** the latent image beeing generated, in case you want to display it */
   latentPreview: Maybe<{
      promptID: Maybe<PromptID>
      receivedAt: number_Timestamp
      blob: Blob
      url: string
   }> = null

   /** byte-level latent-preview hook (e.g. TUI live preview panel) */
   onLatentPreview: Maybe<(p: { bytes: Uint8Array; mime: string; promptID: Maybe<PromptID> }) => void> = null

   /** fires on every ws 'status' message (queue length lives there) */
   onStatus: Maybe<(p: { queueRemaining: number }) => void> = null

   /** fires when the server assigns a NEW session id (first connect AND every
    * reconnect — per-sid server state like log subscriptions must be redone) */
   onSession: Maybe<(sid: string) => void> = null

   /** fires on ws 'logs' messages (server console stream, see subscribeLogs) */
   onLogs: Maybe<(p: { entries: LogEntry[] }) => void> = null

   /** the session assigned to us by the server */
   comfySessionId: string = 'temp' /** send by ComfyUI server */

   /** binary frame types we already complained about (one log per type, no spam) */
   private _unknownBinaryFrameTypes = new Set<number>()

   /** handy to keep around */
   status: ComfyStatusData['status'] | null = null

   /** last time ANY ws message arrived — proof-of-life for the TUI probe: a
    * busy single-threaded ComfyUI stalls NEW connects while established
    * sockets keep streaming (a half-open socket receives nothing, so this
    * never revives one) */
   lastWsMessageAt: number | null = null

   onMessage(e: MessageEvent): void {
      this.lastWsMessageAt = Date.now()
      if (this.data.onWsMessageAny) this.data.onWsMessageAny(e)
      if (e.data instanceof ArrayBuffer) {
         const frame = parseBinaryWsFrame(e.data)
         if (frame.kind === 'preview') {
            // type 1 AND the cloud's type 4 (preview + metadata) feed the same hook
            const imageBlob = new Blob([frame.bytes], { type: frame.mime })
            this.latentPreview = {
               blob: imageBlob,
               url: URL.createObjectURL(imageBlob),
               receivedAt: Date.now() as number_Timestamp,
               promptID: this.activePromptID,
            }
            this.onLatentPreview?.({ bytes: frame.bytes, mime: frame.mime, promptID: this.activePromptID })
         } else if (frame.kind === 'unknown' && !this._unknownBinaryFrameTypes.has(frame.eventType)) {
            // wire tolerance: log once per type, never throw (a throw per sampling
            // step is what the first live cloud run did on type 4)
            this._unknownBinaryFrameTypes.add(frame.eventType)
            console.error(`🔴 unknown binary ws frame type ${frame.eventType} from host ${this.data.id} — ignored`)
         }
         // frame.kind === 'text' (node progress text) is dropped: the json
         // 'progress' messages already carry everything we surface
         return
      }

      const msg_: unknown = JSON.parse(String(e.data))

      // ----- crystools silent fix -----
      if (typeof msg_ === 'object' && msg_ != null && 'type' in msg_) {
         if (msg_.type === 'crystools.monitor') return
      }

      // ----- soft-validate against the schema -----
      const res = WsMsg_ark(msg_)
      if (res instanceof type.errors) {
         console.log(`[🔴] /!\\ Websocket payload does not match schema.`)
         printArkResultInConsole(res)
      }
      // wire tolerance (agent/coding.md): ComfyUI drifts faster than our schema;
      // failures are logged above, then we still route best-effort
      const msg = msg_ as WsMsg

      if (msg.type === 'status') {
         if (msg.data.sid) {
            const sidChanged = msg.data.sid !== this.comfySessionId
            this.comfySessionId = msg.data.sid
            this._sessionResolve?.()
            this._sessionResolve = null
            if (sidChanged) this.onSession?.(msg.data.sid)
         }
         this.status = msg.data.status
         this.onStatus?.({ queueRemaining: msg.data.status?.exec_info?.queue_remaining ?? 0 })
         return
      }

      // defer accumulation to ScriptStep_prompt
      if (msg.type === 'progress') {
         const activePromptID = this.activePromptID
         if (activePromptID == null) {
            console.log(`❌ received a 'progress' msg, but activePromptID is not set`)
            return
         }
         this.routeOrBuffer(activePromptID, msg)
         return
      }
      if (
         msg.type === 'execution_start' ||
         msg.type === 'execution_cached' ||
         msg.type === 'execution_error' ||
         msg.type === 'execution_success' ||
         msg.type === 'executing' ||
         msg.type === 'executed' ||
         msg.type === 'progress_state'
      ) {
         this.routeOrBuffer(msg.data.prompt_id, msg)
         return
      }

      if (msg.type === 'manager-terminal-feedback') {
         this.addLog(msg.data.data)
         return
      }

      if (msg.type === 'logs') {
         this.onLogs?.(msg.data)
         return
      }
      exhaust(msg)
      console.log('❌', 'Unknown message:', msg)

      toastError('Unknown message type: ' + JSON.stringify(msg.type))
      // throw new Error('Unknown message type: ' + JSON.stringify(msg))
   }
}
