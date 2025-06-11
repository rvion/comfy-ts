import { marked } from 'marked'
import { nanoid } from 'nanoid'
import { join } from 'pathe'
import type { ComfyHost } from '../host/ComfyHost'
import { ComfyWorkflowBuilder } from '../host/ComfyWorkflowBuilder'
import { convertFlowToLiteGraphJSON } from '../litegraph/convertFlowToLiteGraphJSON'
import type { LiteGraphJSON } from '../litegraph/LiteGraphJSON'
import { ComfyNode, type ComfyNodeUID } from '../livegraph/ComfyNode'
import type { ComfyNodeId, ComfyNodeMetadata } from '../livegraph/ComfyNodeID'
import type { ComfyPromptL } from '../runner/ComfyPrompt'
import type { ComfySchema } from '../sdk-generator/ComfySchema'
import type { ComfyUIObjectInfoParsed } from '../sdk-generator/ComfyUIObjectInfoParsed'
import type { ComfyUIObjectInfoParsedNodeSchema } from '../sdk-generator/ComfyUIObjectInfoParsedNodeSchema'
import type { ComfyUIAPIRequest } from '../sdk-generator/comfyui-prompt-api'
import {
   type AbsolutePath,
   asAbsolutePath,
   asHTMLContent,
   asMDContent,
   asRelativePath,
   HTMLContent,
   type ImageSaveFormat,
   type Maybe,
   MDContent,
   type Tagged,
} from '../types'
import { bang } from '../utils/bang'
import { comfyColors } from '../utils/ComfyColors'
import type { ApiPromptInput, PromptInfo, WsMsgExecuting, WsMsgExecutionCached, WsMsgProgress } from './ComfyWsApi'

export type ProgressReport = {
   percent: number
   isDone: boolean
   countDone: number
   countTotal: number
}

export type IDNaminScheemeInPromptSentToComfyUI = 'use_stringified_numbers_only' | 'use_class_name_and_number'

export type PromptSettings = {
   saveFormat?: ImageSaveFormat
   idMode?: IDNaminScheemeInPromptSentToComfyUI
}

/**
 * ComfyWorkflowL
 * - holds the nodes
 * - can be instanciated in both extension and webview
 *   - so no link to workspace or run
 */

export const GraphIDCache = new Map<string, number>()

// #region ComfyWorkflow
export type ComfyWorkflow_metadata = { [key: ComfyNodeId]: ComfyNodeMetadata }

export type ComfyWorkflowID = Tagged<string, { ComfyWorkflowID: true }>
export const asComfyWorkflowID = (x: string): ComfyWorkflowID => x

export type ComfyWorkflowData = {
   id?: Maybe<ComfyWorkflowID>

   comfyPromptJSON?: ComfyUIAPIRequest
   metadata: ComfyWorkflow_metadata
}

export class ComfyWorkflow {
   id: ComfyWorkflowID
   comfyPromptJSON: ComfyUIAPIRequest
   outputFolder: AbsolutePath

   constructor(
      public host: ComfyHost,
      public data: ComfyWorkflowData,
   ) {
      this.id = data.id ?? (nanoid(8) as ComfyWorkflowID)
      this.comfyPromptJSON = data.comfyPromptJSON ?? {}
      this.outputFolder = asAbsolutePath(join(cushy.outputPath, `workflow-${this.id}`))
   }

   /** nodes, in creation order */
   nodes: ComfyNode[] = []

   /** @internal every node constructor must call this */
   registerNode = (node: ComfyNode): void => {
      if (this.data.comfyPromptJSON == null) throw new Error('graph not hydrated')
      this.data.comfyPromptJSON[node.uid] = node.json
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
   _problems: { title: string; data?: any }[] = []

   recordProblem = (title: string, data?: any): void => {
      this._problems.push({ title, data })
   }

   /** workflow builder */
   private _builder: ComfyWorkflowBuilder | null = null
   get builder(): ComfyWorkflowBuilder {
      if (this._builder) return this._builder
      this._builder = new ComfyWorkflowBuilder(this)
      return this._builder
   }

   onUpdate = (prev: Maybe<ComfyWorkflowData>, next: ComfyWorkflowData): void => {
      if (prev != null) {
         this.nodes = []
         this.nodesIndex.clear()
         this.currentExecutingNode = null
      }
      for (const [uid, node] of Object.entries(bang(next.comfyPromptJSON))) {
         const meta: Maybe<ComfyNodeMetadata> = next.metadata?.[uid]
         new ComfyNode(this, uid, node, meta)
      }
   }

   get summary1(): string[] {
      return this.nodes.map((n) => n.$schema.nameInCushy)
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

   // findNodeByType = <T extends keyof ComfySetup>(nameInCushy: T): Maybe<ReturnType<ComfySetup[T]>> => {
   //    return this.nodes.find((n) => n.$schema.nameInCushy === nameInCushy) as any
   // }

   /** nodes, indexed by nodeID */
   nodesIndex = new Map<string, ComfyNode>()

   /** convert to mermaid DSL expression for nice graph rendering */
   toMermaid = (DIR: 'LR' | 'TD' = 'LR'): string => {
      const out = [
         `graph ${DIR}`,
         this.nodes.map((n) => `${n.uid}[${n.$schema.nameInCushy}]`).join('\n'),
         this.nodes
            .map((n) =>
               n
                  ._incomingEdges()
                  .map((i) => {
                     const from = this.nodesIndex.get(i.from)

                     return `${from?.uid ?? i.from}[${from?.$schema.nameInCushy ?? i.from}] --> |${i.inputName}|${n.uid}[${
                        n.$schema.nameInCushy
                     }]`
                  })
                  .join('\n'),
            )
            .join('\n'),
      ].join('\n')
      return out
   }

   json_workflow = async (): Promise<LiteGraphJSON> => {
      return convertFlowToLiteGraphJSON(this)
      // cushy.writeTextFile(workflowJSONPath, JSON.stringify(liteGraphJSON, null, 4))
   }
   /** return the coresponding comfy prompt  */
   json_forPrompt = (ns: IDNaminScheemeInPromptSentToComfyUI): ComfyUIAPIRequest => {
      const json: ComfyUIAPIRequest = {}
      for (const node of this.nodes) {
         if (node.disabled) continue
         // console.log(`🦊 ${node.uid}`)
         if (ns === 'use_stringified_numbers_only') {
            json[node.uid] = node.json
         } else {
            json[node.uidPrefixed] = node.json
         }
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
      return asAbsolutePath(join(this.cacheFolderPath, 'workflow.json'))
   }

   getTargetPromptFilePath = (): AbsolutePath => {
      return asAbsolutePath(join(this.cacheFolderPath, 'prompt.json'))
   }

   get cacheFolderPath(): AbsolutePath {
      return cushy.resolve(cushy.outputPath, asRelativePath(`workflows/${this.id}`))
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

   // @deprecated
   get generateMarkdownMermaidSummary(): MDContent {
      return asMDContent([`<pre class="mermaid">`, this.toMermaid(), `</pre>`].join('\n'))
   }

   // @deprecated
   get generateHTMLSummary(): HTMLContent {
      // https://mermaid.js.org/config/usage.html
      return asHTMLContent(marked(this.generateMarkdownMermaidSummary) as string)
   }

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

   /** visjs JSON format (network visualisation) */
   get JSON_forVisDataVisualisation(): { nodes: VisNodes[]; edges: VisEdges[] } {
      const json: ComfyUIAPIRequest = this.json_forPrompt('use_stringified_numbers_only')
      const comfyUIObjectInfo: ComfyUIObjectInfoParsed = this.schema.parseObjectInfo
      const nodes: VisNodes[] = []
      const edges: VisEdges[] = []
      if (json == null) return { nodes: [], edges: [] }
      for (const [uid, node] of Object.entries(json)) {
         const schema: ComfyUIObjectInfoParsedNodeSchema = bang(
            comfyUIObjectInfo.nodesByNameInComfy[node.class_type],
            `unknown node ${node.class_type}`,
         )
         const color = comfyColors[schema.category]
         nodes.push({ id: uid, label: node.class_type, color, font: { color: 'white' }, shape: 'box' })
         for (const [name, val] of Object.entries(node.inputs)) {
            if (val instanceof Array) {
               const [from, slotIx] = val
               const edgeID = `${from}-${uid}-${slotIx}`
               edges.push({
                  id: edgeID,
                  from,
                  to: uid,
                  arrows: 'to',
                  label: name,
                  labelHighlightBold: false,
                  length: 200,
               })
            }
         }
      }
      return { nodes, edges }
   }

   // ------------------------

   /** workflows are created by steps (app/draft/step) */
   stepRef = new LiveRefOpt<this, StepL>(this, 'stepID', 'step')

   /** workflows are created by steps (app/draft/step) */
   get step(): Maybe<StepL> {
      return this.stepRef.item
   }

   /** compute autolayout */
   RUNLAYOUT = (p?: {
      /** @default: 20 */
      node_vsep?: number
      /** @default: 20 */
      node_hsep?: number
      /** @default false */
      forceLeft?: boolean
   }): this => {
      const nodeIds = toposort(
         this.nodes.map((n) => n.uid),
         this.nodes.flatMap((n) => n._incomingNodes().map((from) => [from, n.uid] as TEdge)),
      )
      const nodes = nodeIds.map((id) => this.getNode(id)!)
      const cols: ComfyNode[][] = new Array(nodeIds.length)

      type NodePlacement = {
         node: ComfyNode
         minCol: number
         maxCol?: number
      }
      const ranges: {
         [nodeId: ComfyNodeUID]: NodePlacement
      } = {}

      // console.log(`[🤠] 1/3 ----------------------------`)
      for (const node of nodes) {
         // must be at least 1 after the closest parent
         const parentCols = node.parents.map((p) => ranges[p.uid]!.minCol)
         const minCol = Math.max(...parentCols, -1) + 1
         const range: NodePlacement = { node: node, minCol: minCol }
         ranges[node.uid] = range
      }

      // console.log(`[🤠] 2/3 ----------------------------`)
      if (!p?.forceLeft === true) {
         for (const node of nodes) {
            const range = ranges[node.uid]!
            for (const p of node.parents) {
               const parentRange = ranges[p.uid]!
               parentRange.maxCol =
                  parentRange.maxCol != null
                     ? Math.min(parentRange.maxCol, (range.maxCol ?? range.minCol) - 1)
                     : (range.maxCol ?? range.minCol) - 1
            }
         }
      }

      // console.log(`[🤠] 3/3 ----------------------------`)
      for (const node of nodes) {
         const range = ranges[node.uid]!
         const at = range.maxCol ?? range.minCol
         if (cols[at]) cols[at]!.push(node)
         else cols[at] = [node]
      }

      const HSEP = p?.node_hsep ?? 20
      const VSEP = p?.node_vsep ?? 20
      // cols.reverse()
      let colX = 0
      let maxY = 0
      for (const col of cols) {
         if (col == null) continue
         let colWidth = 0
         let currNodeY = 32
         const nodesSorted = col.toSorted((a, b) => b.height - a.height)
         for (const node of nodesSorted) {
            colWidth = Math.max(colWidth, node.width)
            node.x = colX
            node.y = currNodeY
            currNodeY += node.height + VSEP /* V SEP */
         }
         maxY = Math.max(maxY, currNodeY)
         colX += colWidth + HSEP /* H SEP */
      }

      this.height = maxY
      this.width = colX
      return this
   }

   width: number = 100
   height: number = 100

   sendPromptAndWaitUntilDone = async (p: PromptSettings = {}): Promise<ComfyPromptL> => {
      const prompt = await this.sendPrompt(p)
      await prompt.finished
      return prompt
   }

   sendPrompt = async (p: PromptSettings = {}): Promise<ComfyPromptL> => {
      const step = this.step
      const currentJSON = deepCopyNaive(this.json_forPrompt(p.idMode ?? 'use_stringified_numbers_only'))
      const litegraphWorkflow = await this.RUNLAYOUT().json_workflow()

      const out: ApiPromptInput = {
         client_id: cushy.comfySessionId,
         extra_data: {
            extra_pnginfo: {
               // regular ComfyUI metadat
               workflow: litegraphWorkflow,

               // Cushy metadata
               cushy_app_id: this.step?.data.appID,
               // cushy_draft_result: this.step?.data.formResult,
               cushy_draft_serial: this.step?.data.formSerial,
            },
         },
         prompt: currentJSON,
      }

      // 🔶 not waiting here, because output comes back from somewhere else
      // TODO: but we may want to catch error here to fail early
      // otherwise, we might get stuck
      const promptEndpoint = `${cushy.getServerHostHTTP()}/prompt`
      console.groupCollapsed('Sending PROMPT to ' + promptEndpoint)
      console.log(JSON.stringify(currentJSON))
      console.groupEnd()

      // meh  --------------------------------------------
      // this.update({ comfyPromptJSON: currentJSON })
      // -------------------------------------------------

      const graph = new ComfyWorkflow(this.host, {
         //
         comfyPromptJSON: currentJSON,
         metadata: this.data.metadata,
      })

      graph.RUNLAYOUT(cushy.autolayoutOpts)
      const res = await fetch(promptEndpoint, {
         method: 'POST',
         body: JSON.stringify(out),
      })
      const prompmtInfo: PromptInfo = await res.json()
      // console.log('prompt status', res.status, res.statusText, prompmtInfo)
      // this.step.addOutput({ type: 'prompt', promptID: prompmtInfo.prompt_id })
      if (res.status !== 200) {
         const err = new InvalidPromptError('ComfyUI Prompt request failed', graph, prompmtInfo)
         return Promise.reject(err)
      } else {
         const prompt = cushy.db.comfy_prompt.create({
            id: prompmtInfo.prompt_id,
            executed: 0,
            graphID: graph.id,
            stepID: bang(step).id, // 🔴
            // quality: p.saveFormat?.quality,
            // format: p.saveFormat?.format,
         })

         // 🔶 only live while app is running
         prompt.saveFormat = p.saveFormat
         return prompt
      }
   }
}
