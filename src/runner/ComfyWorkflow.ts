import { nanoid } from 'nanoid'
import { describePromptRejection } from 'src/runner/describePromptRejection.ts'
import { join } from 'pathe'
import { InvalidPromptError } from 'src/errors/InvalidPromptError.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyWorkflowBuilder } from 'src/host/ComfyWorkflowBuilder.ts'
import { convertFlowToLiteGraphJSON } from 'src/litegraph/convertFlowToLiteGraphJSON.ts'
import type { LiteGraphJSON } from 'src/litegraph/LiteGraphJSON.ts'
import { ComfyNode } from 'src/graph/ComfyNode.ts'
import type { ComfyNodeId, ComfyNodeMetadata } from 'src/graph/ComfyNodeID.ts'
import { ComfyExecution, type ExecutionProgress } from 'src/runner/ComfyExecution.ts'
import { rewriteSaveNodesToWebsocket } from 'src/runner/ephemeral.ts'
import type { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import type { ComfyApiJson, ComfyApiNodeJson } from 'src/sdk-generator/comfy-api-json.ts'
import { type AbsolutePath, type Maybe, type SaveOptions, type Tagged } from 'src/types/index.ts'
import type { SdkForHost } from 'src/types/comfy-sdk.ts'
import { bang } from 'src/utils/bang.ts'
import { deepCopyNaive } from 'src/utils/deepCopyNaive.ts'
import { softValidate } from 'src/utils/softValidate.ts'
import { comfyWorkflowAutoLayout } from 'src/runner/ComfyWorkflowLayout.ts'
import {
   type ApiPromptInput,
   type PromptInfo,
   PromptInfo_ark,
   type WsMsgExecuting,
   type WsMsgExecutionCached,
   type WsMsgProgress,
} from 'src/runner/ComfyWsApi.ts'

export type ProgressReport = {
   percent: number
   isDone: boolean
   countDone: number
   countTotal: number
}

export type ComfyNodeIdMode = 'use_stringified_numbers_only' | 'use_class_name_and_number'

export type RunSettings = {
   /** local disk saving is OPT-IN: unset/false keeps outputs in memory only
    * (`execution.images` buffers); `true` = raw save, an object re-encodes/relocates */
   save?: boolean | SaveOptions
   /** rewrite every SaveImage node to SaveImageWebsocket in the SENT prompt —
    * outputs never touch the server disk. Implies `scrubHistory` unless that
    * is explicitly false. (architecture.md item 14) */
   ephemeral?: boolean
   /** delete this run's server history entry (workflow JSON, prompts, filenames)
    * after `done` — loud but non-fatal on failure */
   scrubHistory?: boolean
   idMode?: ComfyNodeIdMode
   /** render a live single-line progress report to the console */
   log?: boolean
   /** called on every progress-relevant websocket message */
   onProgress?: (p: ExecutionProgress) => void
}

/** exactly what was sent to the host for one execution, frozen at send time */
export type ExecutionSnapshot = {
   apiJson: ComfyApiJson
   workflowJson: LiteGraphJSON
}

/**
 * ComfyWorkflowL
 * - holds the nodes
 * - can be instanciated in both extension and webview
 *   - so no link to workspace or run
 */

// #region ComfyWorkflow
export type ComfyWorkflow_metadata = { [key: ComfyNodeId]: ComfyNodeMetadata }

export type ComfyWorkflowID = Tagged<string, { ComfyWorkflowID: true }>
export const asComfyWorkflowID = (x: string): ComfyWorkflowID => x

export type ComfyWorkflowData = {
   id?: Maybe<ComfyWorkflowID>

   apiJson?: ComfyApiJson
   metadata: ComfyWorkflow_metadata
}

export class ComfyWorkflow<ID extends string = string> {
   id: ComfyWorkflowID
   apiJson: ComfyApiJson
   outputFolder: AbsolutePath

   constructor(
      public host: ComfyHost<ID>,
      public data: ComfyWorkflowData,
   ) {
      this.id = data.id ?? (nanoid(8) as ComfyWorkflowID)
      // ONE json object, shared by the field and the data record (registerNode writes there)
      this.apiJson = data.apiJson ?? {}
      data.apiJson = this.apiJson
      this.outputFolder = join(comfyts.outputPath, `workflow-${this.id}`)
   }

   /** nodes, in creation order */
   nodes: ComfyNode[] = []

   /** @internal every node constructor must call this */
   registerNode = (node: ComfyNode): void => {
      if (this.data.apiJson == null) throw new Error('graph not hydrated')
      this.data.apiJson[node.uid] = node.json
      this.data.metadata[node.uid] = node.meta
      this.nodesIndex.set(node.uid, node)
      this.nodes.push(node)
   }

   /** number of node in the graph */
   get size(): number {
      return this.nodes.length
   }

   setMetadata = (nodeID: ComfyNodeId, meta: ComfyNodeMetadata): void => {
      this.data.metadata[nodeID] = meta
   }

   getMetadata = (nodeID: ComfyNodeId): Maybe<ComfyNodeMetadata> => {
      return this.data.metadata[nodeID] ?? null
   }

   /** problem accumulator */
   problems: { title: string; data?: unknown }[] = []

   recordProblem = (title: string, data?: unknown): void => {
      this.problems.push({ title, data })
   }

   /** workflow builder, typed from the generated per-host sdk when one is in scope */
   private _builder: ComfyWorkflowBuilder | null = null
   get builder(): SdkForHost<ID>['Builder'] {
      if (this._builder == null) this._builder = new ComfyWorkflowBuilder(this)
      // sanctioned cast (see agent/coding.md): the runtime builder defines its
      // methods dynamically from the live schema; the static face comes from
      // the generated per-host sdk. Both derive from the same object_info.
      return this._builder as SdkForHost<ID>['Builder']
   }

   /** base (untyped) view of the same builder, for generic library code */
   get builderBase(): Comfy.Builder {
      if (this._builder == null) this._builder = new ComfyWorkflowBuilder(this)
      return this._builder as Comfy.Builder
   }

   onUpdate = (prev: Maybe<ComfyWorkflowData>, next: ComfyWorkflowData): void => {
      if (prev != null) {
         this.nodes = []
         this.nodesIndex.clear()
         this.currentExecutingNode = null
      }
      for (const [uid, node] of Object.entries(bang(next.apiJson))) {
         const meta: Maybe<ComfyNodeMetadata> = next.metadata?.[uid]
         new ComfyNode(this, uid, node, meta)
      }
   }

   /** proxy to this.db.schema */
   get schema(): ComfySchema {
      return this.host.schema
   }

   /** nodes that are still pending execution */
   get pendingNodes(): ComfyNode[] {
      return this.nodes.filter((n) => n.status == null || n.status === 'waiting')
   }

   get nodesByUpdatedAt(): ComfyNode[] {
      return this.nodes //
         .filter((n) => n.status != null && n.status !== 'waiting')
         .sort((a, b) => b.updatedAt - a.updatedAt)
      // return this.nodes.slice().sort((a, b) => b.updatedAt - a.updatedAt)
   }

   // findNodeByType = <T extends keyof ComfySetup>(nodeKey: T): Maybe<ReturnType<ComfySetup[T]>> => {
   //    return this.nodes.find((n) => n.$schema.nodeKey === nodeKey) as any
   // }

   /** nodes, indexed by nodeID */
   nodesIndex = new Map<string, ComfyNode>()

   /** convert to mermaid DSL expression for nice graph rendering */
   toMermaid = (DIR: 'LR' | 'TD' = 'LR'): string => {
      const out = [
         `graph ${DIR}`,
         this.nodes.map((n) => `${n.uid}[${n.$schema.nodeKey}]`).join('\n'),
         this.nodes
            .map((n) =>
               n
                  ._incomingEdges()
                  .map((i) => {
                     const from = this.nodesIndex.get(i.from)

                     return `${from?.uid ?? i.from}[${from?.$schema.nodeKey ?? i.from}] --> |${i.inputName}|${n.uid}[${
                        n.$schema.nodeKey
                     }]`
                  })
                  .join('\n'),
            )
            .join('\n'),
      ].join('\n')
      return out
   }

   /** export the graph in ComfyUI's saved-workflow format (autolayouted by default) */
   toWorkflowJson = async (p: { layout?: boolean } = {}): Promise<LiteGraphJSON> => {
      if (p.layout !== false) this.autoLayout()
      return convertFlowToLiteGraphJSON(this)
   }

   /** export the graph in ComfyUI's api format (what POST /prompt takes) */
   toApiJson = (ns: ComfyNodeIdMode = 'use_stringified_numbers_only'): ComfyApiJson => {
      const json: ComfyApiJson = {}
      const keyOf = (uid: string): string =>
         ns === 'use_stringified_numbers_only' ? uid : (this.nodesIndex.get(uid)?.uidPrefixed ?? uid)
      for (const node of this.nodes) {
         if (node.disabled) continue
         const key = ns === 'use_stringified_numbers_only' ? node.uid : node.uidPrefixed
         // links reference node keys — remap them to whatever key scheme we emit
         const inputs: ComfyApiNodeJson['inputs'] = {}
         for (const [name, value] of Object.entries(node.json.inputs)) {
            inputs[name] =
               Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'number'
                  ? [keyOf(value[0]), value[1]]
                  : value
         }
         json[key] = { class_type: node.json.class_type, inputs }
      }
      return json
   }

   /** @internal pointer to the currently executing node */
   currentExecutingNode: ComfyNode | null = null

   get progressCurrentNode(): Maybe<ProgressReport> {
      return this.currentExecutingNode?.progressReport
   }

   get progressGlobal(): ProgressReport {
      const totalNode = this.nodes.length
      const doneNodes = this.nodes.filter((n) => n.status === 'done' || n.status === 'cached').length
      const bonus = this.currentExecutingNode?.progressRatio ?? 0
      const score = (doneNodes + bonus) / totalNode
      const percent = this.done ? 100 : score * 100
      const isDone = this.done
      return { percent, isDone, countDone: doneNodes + bonus, countTotal: totalNode }
   }

   /** @internal update the progress value of the currently focused onde */
   onProgress = (msg: WsMsgProgress): void => {
      if (this.currentExecutingNode == null) return void console.log('❌ no current executing node', msg)
      this.currentExecutingNode.progress = msg.data
      this.currentExecutingNode.progressRatio = (msg.data.value ?? 0) / (msg.data.max || 1)
   }

   getTargetWorkflowFilePath = (): AbsolutePath => {
      return join(this.cacheFolderPath, 'workflow.json')
   }

   getTargetPromptFilePath = (): AbsolutePath => {
      return join(this.cacheFolderPath, 'prompt.json')
   }

   get cacheFolderPath(): AbsolutePath {
      return comfyts.resolveFromOutput(`workflows/${this.id}`)
   }

   // private outputs: WsMsgExecuted[] = []
   // images: ImageL[] = []

   done: boolean = false

   /** @internal update pointer to the currently executing node */
   onExecuting = (msg: WsMsgExecuting): void => {
      // 1. mark currentExecutingNode as done
      if (this.currentExecutingNode) {
         this.currentExecutingNode.status = 'done'
         // this.currentExecutingNode.updatedAt = Date.now() + 1000
      }
      // 2. then two cases:
      // 2.A. no node => the prompt is done
      if (msg.data.node == null) {
         this.currentExecutingNode = null
         this.done = true
         return
      }

      this.done = false
      // 2.B. a node => node evaluation is starting
      const node = this.getNodeOrCrash(msg.data.node)
      this.currentExecutingNode = node
      node.status = 'executing'
      node.updatedAt = Date.now()
   }

   onExecutionCached = (msg: WsMsgExecutionCached): void => {
      for (const x of msg.data.nodes) {
         const node = this.getNodeOrCrash(x)
         node.status = 'cached'
      }
   }

   // onExecuted = (msg: WsMsgExecuted) => {
   //     const node = this.getNodeOrCrash(msg.data.node)
   //     const images = msg.data.output.images.map((i) => new PromptOutputImage(this, i))

   //     // console.log(`🟢 `, images.length, `CushyImages`)
   //     // accumulate in self
   //     this.outputs.push(msg)
   //     this.images.push(...images)
   //     // console.log(`🟢 `, this.uid, 'has', this.images.length, `CushyImages`)

   //     // accumulate in node
   //     node.artifacts.push(msg.data)
   //     node.images.push(...images)
   // }

   _uidNumber: number = 0

   getNodeOrCrash = (nodeID: ComfyNodeId): ComfyNode => {
      const node = this.nodesIndex.get(nodeID)
      if (node == null) throw new Error('Node not found:' + nodeID)
      return node
   }

   getNode = (nodeID: ComfyNodeId): Maybe<ComfyNode> => {
      const node = this.nodesIndex.get(nodeID)
      return node
   }

   width: number = 100
   height: number = 100

   /** compute autolayout **/
   autoLayout = comfyWorkflowAutoLayout.bind(this)

   /** send the workflow and wait for it to finish (with all outputs downloaded) */
   run = async (p: RunSettings = {}): Promise<ComfyExecution> => {
      const execution = await this.start(p)
      await execution.done
      return execution
   }

   /** reset per-run node state so the same workflow can run again cleanly */
   private resetRunState(): void {
      this.done = false
      this.currentExecutingNode = null
      for (const node of this.nodes) {
         node.status = null
         node.progress = null
         node.progressRatio = 0
      }
   }

   /** send the workflow; returns the live execution (await `execution.done` yourself) */
   start = async (p: RunSettings = {}): Promise<ComfyExecution> => {
      // without a ws the prompt still RUNS on the host, but its messages route to a session
      // that is not ours, so `execution.done` never settles: a silent forever-hang, the one
      // failure mode with no error to read. DefinedWorkflow.run() connects for you
      if (this.host.ws == null)
         throw new Error(
            `🔴 host '${this.host.data.id}' was never connected — call \`await host.connect()\` before running a workflow`,
         )
      this.resetRunState()
      // snapshot: exactly what runs, frozen at send time (the live workflow stays editable)
      const snapshot: ExecutionSnapshot = {
         apiJson: deepCopyNaive(this.toApiJson(p.idMode ?? 'use_stringified_numbers_only')),
         workflowJson: await this.toWorkflowJson(),
      }
      // ephemeral: rewrite in the SNAPSHOT only — the live graph stays editable/exportable as authored
      if (p.ephemeral) {
         const rewritten = rewriteSaveNodesToWebsocket(snapshot.apiJson)
         const hasWsSaver = Object.values(snapshot.apiJson).some((n) => n.class_type === 'SaveImageWebsocket')
         if (rewritten === 0 && !hasWsSaver)
            console.warn(
               `🟡 ephemeral run: no SaveImage/SaveImageWebsocket node in workflow '${this.id}' — nothing streams back`,
            )
      }
      const out: ApiPromptInput = {
         client_id: this.host.comfySessionId,
         prompt: snapshot.apiJson,
         extra_data: {
            extra_pnginfo: {
               // regular ComfyUI metadata (drag the file in the editor -> the graph)
               workflow: snapshot.workflowJson,
               comfy_ts_workflow_id: this.id,
               comfy_ts_version: comfyts.version,
            },
         },
      }

      const res = await this.host.fetch('/prompt', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(out),
      })
      const promptInfoJson: unknown = await res.json()
      // a REJECTED prompt is not a malformed success: ComfyUI answers non-200 with its own
      // reason and no prompt_id, so validating first reported "prompt_id must be a string"
      // and threw away the sentence that says which node and which value it refused
      if (res.status !== 200) {
         throw new InvalidPromptError(
            `ComfyUI refused the prompt: ${describePromptRejection(promptInfoJson)}`,
            snapshot,
            promptInfoJson,
         )
      }
      const promptInfo: PromptInfo = softValidate(PromptInfo_ark, promptInfoJson)
      // settings + snapshot go through the constructor: the ctor flushes ws
      // messages that raced ahead, and those handlers need the settings
      const execution = new ComfyExecution(
         this,
         {
            id: promptInfo.prompt_id,
            executed: false,
            graphID: this.id,
         },
         {
            snapshot,
            save: p.save,
            ephemeral: p.ephemeral ?? false,
            // ephemeral implies the scrub unless the caller explicitly opted out
            scrubHistory: p.scrubHistory ?? p.ephemeral ?? false,
            onProgress: p.onProgress,
            logProgress: p.log ?? false,
         },
      )
      return execution
   }
}
