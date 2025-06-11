import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { type } from 'arktype'
import type { HeadersInit } from 'bun'
import type { MessageEvent } from 'ws'
import type { KnownComfyPluginTitle } from '../manager/generated/KnownComfyPluginTitle'
import type { KnownComfyPluginURL } from '../manager/generated/KnownComfyPluginURL'
import type { ComfyManagerPluginInfo } from '../manager/types/ComfyManagerPluginInfo'
import type { ComfyPromptL } from '../runner/ComfyPrompt'
import { asComfyWorkflowID, ComfyWorkflow } from '../runner/ComfyWorkflow'
import {
   type ComfyStatusData,
   type PromptID,
   type PromptRelated_WsMsg,
   type WsMsg,
   WsMsg_ark,
} from '../runner/ComfyWsApi'
import { ComfySchema } from '../sdk-generator/ComfySchema'
import { type ComfySchemaJSON, ComfySchemaJSON_ark } from '../sdk-generator/ComfyUIObjectInfoTypes'
import type { EmbeddingName } from '../sdk-generator/comfyui-types'
import { type AbsolutePath, asRelativePath, type Maybe, type number_Timestamp, type Tagged } from '../types'
import { exhaust } from '../utils/exhaust'
import { extractErrorMessage } from '../utils/extractErrorMessage'
import { printArkResultInConsole } from '../utils/printArkResultInConsole'
import { readableStringify } from '../utils/stringifyReadable'
import { toastError } from '../utils/toast'
import { writeFileAsync } from '../utils/writeFile'
import type { ComfyInstallType } from './ComfyInstallType'
import { ComfyManager } from './ComfyManager'
import type { Requirements } from './Requirements'
import { ResilientWebSocketClient } from './ResilientWebsocket'

export type ComfyHostID = Tagged<string, { HostID: true }>
export type ComfyHostData = {
   id: ComfyHostID
   host: string
   port: number
   https?: boolean

   // for extra features using path manipulation
   installType?: ComfyInstallType

   // misc
   onWsMessageAny?: (e: MessageEvent) => void
   onWsMessageArrayBuffer?: (e: ArrayBuffer) => void
   onWsMessageJSON?: (e: WsMsg) => void
}

// biome-ignore format: misc
type SchemaUpdateResult = Maybe<
   | { type: 'success' }
   | { type: 'error'; error: unknown }
>

type ServerLog = {
   at: string
   content: string
   id: number
}

export class ComfyHost {
   // ----- misc paths where we'll store host-related files -----
   cacheFolder: AbsolutePath

   comfyJSONPath: AbsolutePath
   embeddingsPath: AbsolutePath
   sdkDTSPath: AbsolutePath

   /** the schema instance with all methods to interract with the host schema */
   schema: ComfySchema

   constructor(public data: ComfyHostData) {
      /** folder where file related to the host config will be cached */
      this.cacheFolder = cushy.resolve(cushy.outputPath, asRelativePath(`hosts/${this.data.id}`))

      // create the folder if it does not exist
      const exists = existsSync(this.cacheFolder)
      if (!exists) {
         console.log('🟢 creating folder', this.cacheFolder)
         mkdirSync(this.cacheFolder, { recursive: true })
      }

      this.comfyJSONPath = cushy.resolve(this.cacheFolder, asRelativePath(`object_info.json`))
      this.embeddingsPath = cushy.resolve(this.cacheFolder, asRelativePath(`embeddings.json`))
      this.sdkDTSPath = cushy.resolve(this.cacheFolder, asRelativePath(`sdk.d.ts`))

      /** create a new schema */
      this.schema = new ComfySchema({ embeddings: [], spec: {} })
   }

   /** helper to check if your host have whatever it needs to run your workflow */
   matchRequirements = (requirements: Requirements[]): boolean => {
      const repo = cushy.registry
      for (const req of requirements) {
         if (req.optional) continue
         if (req.type === 'customNodesByNameInCushy') {
            const plugins: ComfyManagerPluginInfo[] = repo.plugins_byNodeNameInCushy.get(req.nodeName) ?? []
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
      const manager = cushy.registry
      const plugin: ComfyManagerPluginInfo | undefined = manager.plugins_byFile.get(customNodeFile)
      if (plugin == null) throw new Error(`Unknown custom node for file: "${customNodeFile}"`)
      return this.manager.installPlugin(plugin)
   }

   installCustomNodeByTitle = async (customNodeTitle: KnownComfyPluginTitle): Promise<boolean> => {
      const manager = cushy.registry
      const plugin: ComfyManagerPluginInfo | undefined = manager.plugins_byTitle.get(customNodeTitle)
      if (plugin == null) throw new Error(`Unknown custom node for title: "${customNodeTitle}"`)
      return this.manager.installPlugin(plugin)
   }

   installCustomNode = async (customNode: ComfyManagerPluginInfo): Promise<boolean> => {
      return this.manager.installPlugin(customNode)
   }

   // URLS -----------------------------------------------------------------------------
   getServerHostHTTP(): string {
      const method = this.data.https ? 'https' : 'http'
      const host = this.data.host
      const port = this.data.port
      return `${method}://${host}:${port}`
   }

   getWSUrl = (): string => {
      const method = this.data.https ? 'wss' : 'ws'
      const host = this.data.host
      const port = this.data.port
      return `${method}://${host}:${port}/ws`
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

   createEmptyWorkflow = (p: { id?: string } = {}): ComfyWorkflow => {
      return new ComfyWorkflow(this, {
         metadata: {},
         id: p.id ? asComfyWorkflowID(p.id) : undefined,
      })
   }

   CONNECT = (): void => {
      // void this.updateSchemaFromFileCache()
      this.initWebsocket()
   }

   private async writeSDKToDisk(): Promise<void> {
      const comfySchemaTs = this.schema.parseObjectInfo.codegenDTS()
      await writeFileAsync(this.sdkDTSPath, comfySchemaTs, 'utf-8')
   }

   // WEBSCKET -----------------------------------------------------------------------------
   /**
    * will be created only after we've loaded cnfig file
    * so we don't attempt to connect to some default server
    * */
   ws: Maybe<ResilientWebSocketClient> = null

   private initWebsocket(): ResilientWebSocketClient {
      console.log(`[👢] WEBSOCKET: starting client to ComfyUI host ${this.data.id}`)
      this.ws = new ResilientWebSocketClient({
         onConnectOrReconnect: (): Promise<void> => {
            console.log(`[👢] WEBSOCKET: connected to ComfyUI host ${this.data.id}`)
            return this.fetchAndUpdateSchema()
         },
         onMessage: (e: MessageEvent): void => this.onMessage(e),
         url: () => this.getWSUrl(),
         onClose: (): void => {
            console.log(`[👢] WEBSOCKET: closed connection to ComfyUI host ${this.data.id}`)
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

   private async updateSchemaFromFileCache(): Promise<void> {
      const object_info_json = cushy.readJSON_<ComfySchemaJSON>(this.comfyJSONPath)
      const embeddings_json = cushy.readJSON_<string[]>(this.embeddingsPath)

      // update schema
      this.schema.update({ spec: object_info_json, embeddings: embeddings_json })
      this.schema.RUN_BASIC_CHECKS()

      // regen sdk
      await this.writeSDKToDisk()
   }

   /** retrieve the comfy spec from the schema*/
   fetchAndUpdateSchema = async (): Promise<void> => {
      try {
         this.isUpdatingSchema = true
         // ------------------------------------------------------------------------------------
         // 1. fetch schema$
         // let object_info_json: ComfySchemaJSON = this.schema.data.spec
         // 1 ------------------------------------
         // download object_info
         const headers: HeadersInit = { 'Content-Type': 'application/json' }
         const object_info_url = `${this.getServerHostHTTP()}/object_info`
         const object_info_res = await fetch(object_info_url, { method: 'GET', headers })
         const object_info_json = (await object_info_res.json()) as { [key: string]: any }
         const object_info_str = readableStringify(object_info_json, 4)
         void writeFileAsync(this.comfyJSONPath, object_info_str, 'utf-8')
         // use valibot to check if payload match the type, and display errors if not
         const res = ComfySchemaJSON_ark(object_info_json)
         if (res instanceof type.errors) {
            printArkResultInConsole(res)
         }

         // 2 ------------------------------------
         // download embeddigns
         const embeddings_url = `${this.getServerHostHTTP()}/embeddings`
         const embeddings_res = await fetch(embeddings_url, { method: 'GET', headers })
         const embeddings_json = (await embeddings_res.json()) as EmbeddingName[]
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
         console.error('🔴 FAILURE TO GENERATE nodes.d.ts', extractErrorMessage(error))

         const schemaExists = existsSync(this.sdkDTSPath)
         if (!schemaExists) await this.writeSDKToDisk()
      } finally {
         this.isUpdatingSchema = false
      }
   }

   /** prompts we sent */
   prompts: Map<PromptID, ComfyPromptL> = new Map()

   /** buffer in case we receive packets out of order */
   _pendingMsgs = new Map<PromptID, PromptRelated_WsMsg[]>()

   /** the active prompt currently running on this host */
   private activePromptID: PromptID | null = null

   /** method to either execute or buffer the incoming message */
   temporize(prompt_id: PromptID, msg: PromptRelated_WsMsg): void {
      this.activePromptID = prompt_id
      const prompt = this.prompts.get(prompt_id)

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
      promtID: Maybe<PromptID>
      receivedAt: number_Timestamp
      blob: Blob
      url: string
   }> = null

   /** the session assigned to us by the server */
   comfySessionId: string = 'temp' /** send by ComfyUI server */

   /** handy to keep around */
   status: ComfyStatusData['status'] | null = null

   onMessage(e: MessageEvent): void {
      if (this.data.onWsMessageAny) this.data.onWsMessageAny(e)
      if (e.data instanceof ArrayBuffer) {
         // 🔴 console.log('[👢] WEBSOCKET: received ArrayBuffer', e.data)
         const view = new DataView(e.data)
         const eventType = view.getUint32(0)
         const buffer = e.data.slice(4)
         switch (eventType) {
            case 1: {
               const view2 = new DataView(e.data)
               const imageType = view2.getUint32(0)
               let imageMime: string
               switch (imageType) {
                  case 1:
                     imageMime = 'image/jpeg'
                     break
                  case 2:
                     imageMime = 'image/png'
                     break
                  default:
                     imageMime = 'image/jpeg'
                     break
               }
               const imageBlob = new Blob([buffer.slice(4)], { type: imageMime })
               const imagePreview = URL.createObjectURL(imageBlob)
               this.latentPreview = {
                  blob: imageBlob,
                  url: imagePreview,
                  receivedAt: Date.now() as number_Timestamp,
                  promtID: this.activePromptID,
               }
               break
            }
            default:
               throw new Error(`Unknown binary websocket message of type ${eventType}`)
         }
         return
      }

      const msg_: unknown = JSON.parse(e.data as any)
      const msg = msg_ as WsMsg

      // ----- crystools silent fix -----
      if (typeof msg_ === 'object' && msg_ != null && 'type' in msg_) {
         if (msg_.type === 'crystools.monitor') return
      }

      // ----- check if the message matches the schema -----
      const shouldCheckPAYLOADS = true
      if (shouldCheckPAYLOADS) {
         const res = WsMsg_ark(msg_)
         if (res instanceof type.errors) {
            console.log(`[🔴] /!\\ Websocket payload does not match schema.`)
            printArkResultInConsole(res)
            console.log('🔴 payload', msg_)
         }
      }

      if (msg.type === 'status') {
         if (msg.data.sid) this.comfySessionId = msg.data.sid
         this.status = msg.data.status
         return
      }

      // defer accumulation to ScriptStep_prompt
      if (msg.type === 'progress') {
         const activePromptID = this.activePromptID
         if (activePromptID == null) {
            console.log(`❌ received a 'progress' msg, but activePromptID is not set`)
            return
         }
         this.temporize(activePromptID, msg)
         return
      }
      if (
         msg.type === 'execution_start' ||
         msg.type === 'execution_cached' ||
         msg.type === 'execution_error' ||
         msg.type === 'execution_success' ||
         msg.type === 'executing' ||
         msg.type === 'executed'
      ) {
         this.temporize(msg.data.prompt_id, msg)
         return
      }

      if (msg.type === 'manager-terminal-feedback') {
         this.addLog(msg.data.data)
         return
      }
      exhaust(msg)
      console.log('❌', 'Unknown message:', msg)

      toastError('Unknown message type: ' + JSON.stringify(msg.type))
      // throw new Error('Unknown message type: ' + JSON.stringify(msg))
   }
}
