import type { ComfyWorkflow, ProgressReport } from '../runner/ComfyWorkflow'
import type { NodeProgress } from '../runner/ComfyWsApi'
import type { ComfyUIObjectInfoParsedNodeSchema } from '../sdk-generator/ComfyUIObjectInfoParsedNodeSchema'
import type { ComfyUIAPIRequest_Node } from '../sdk-generator/comfyui-prompt-api'
import type { NodeInputExt, NodeOutputExt } from '../sdk-generator/comfyui-types'
import { ComfyDefaultNodeWhenUnknown_Name } from '../sdk-generator/Primitives'
import type { Maybe } from '../types'
import { comfyColors } from '../utils/ComfyColors'
import { auto_ } from './autoValue'
import type { ComfyNodeId, ComfyNodeMetadata } from './ComfyNodeID'
import { ComfyNodeOutput } from './ComfyNodeOutput'
import { NodeSlotSize, NodeTitleHeight, nodeLineHeight } from './NodeSlotSize'

type NodeExecutionStatus = 'executing' | 'done' | 'error' | 'waiting' | 'cached' | null

export type NodePort = {
   id: string
   label: string
   width: number
   height: number
   type: string
   x: number
   y: number
   toNode?: ComfyNode<object, object> | undefined
   fromNode?: ComfyNode<object, object> | undefined
}

export type ComfyNodeUID = string

/** ComfyNode
 * - correspond to a signal in the graph
 * - belongs to a script
 */
export class ComfyNode<
   //
   ComfyNode_input extends object = object,
   ComfyNode_output extends object = object,
> {
   storeAs(storeName: string): this {
      this.meta.storeAs = storeName
      return this
   }

   tag(tagName: string): this {
      this.addTag(tagName)
      return this
   }

   addTag(tag: string): this {
      if (this.meta.tags == null) this.meta.tags = [tag]
      else this.meta.tags.push(tag)
      return this
   }
   // ---------------------------------------

   /** reported though websocket by ComfyUI */
   status: NodeExecutionStatus = null

   /** last raw progress message reported by comfy */
   progress: NodeProgress | null = null

   /**
    * updated on websocket progress report from the progress property just above
    * between [0, 1]
    * */
   progressRatio: number = 0

   get progressReport(): ProgressReport {
      const percent = this.status === 'done' ? 100 : this.progressRatio * 100
      const isDone = this.status === 'done'
      return { percent, isDone, countDone: this.progressRatio * 100, countTotal: 100 }
   }

   $schema: ComfyUIObjectInfoParsedNodeSchema
   updatedAt: number = Date.now()
   json: ComfyUIAPIRequest_Node

   get isExecuting(): boolean {
      return this.status === 'executing'
   }

   disabled: boolean = false

   disable(): void {
      this.disabled = true
   }

   get inputs(): ComfyNode_input {
      return this.json.inputs as unknown as ComfyNode_input
   }

   /** update a node */
   set(p: Partial<ComfyNode_input>): this {
      for (const [key, value] of Object.entries(p)) {
         const next = this.serializeValue(key, value)
         const prev = this.json.inputs[key]
         if (next === prev) continue
         this.json.inputs[key] = next as any // 🔴
      }
      return this
      // 🔴 wrong resonsibility
      // console.log('CHANGES', changes)
   }

   get color(): string {
      return comfyColors[this.$schema.category] ?? '#aaa'
   }

   uidNumber: number
   $outputs: ComfyNodeOutput<keyof Comfy.Signal>[] = []
   outputs: ComfyNode_output
   uidPrefixed: string

   constructor(
      public graph: ComfyWorkflow,
      public uid: ComfyNodeUID, //  = graph.getUID(),
      jsonExt: ComfyUIAPIRequest_Node,
      public meta: ComfyNodeMetadata = {},
   ) {
      this.uidNumber = this.graph._uidNumber++
      if (jsonExt == null) throw new Error('invariant violation: jsonExt is null')
      // this.json = graph.data.comfyPromptJSON[uid]
      // if (this.json == null) graph.data.comfyPromptJSON = {}
      // console.log('CONSTRUCTING', xxx.class_type, uid)

      // this.uidNumber = parseInt(uid) // 🔴 ugly
      this.$schema =
         graph.schema.nodesByNameInComfy[jsonExt.class_type]! ??
         graph.schema.nodesByNameInComfy[ComfyDefaultNodeWhenUnknown_Name] // 🔴 ? do we want to do that ?

      if (this.$schema == null) {
         console.log(`❌ available nodes:`, Object.keys(graph.schema.nodesByNameInComfy).join(','))
         throw new Error(`❌ no schema found for node "${jsonExt.class_type}"`)
         // throw new Error('')
      }
      this.uidPrefixed = `${this.$schema.nameInCushy}_${this.uidNumber}`
      let ix = 0

      // 🔶 1 this declare the json locally,
      // but Node are not live instances, they're local subinstances to a LiveGraph
      this.json = this._convertPromptExtToPrompt(jsonExt)
      // 🔶 2 so we need to ensure the json is properly synced with the LiveGraph data
      // register node ensure this
      this.graph.registerNode(this)

      // dynamically add properties for every outputs
      const outputs: { [key: string]: any } = {}
      for (const x of this.$schema.outputs) {
         const output = new ComfyNodeOutput(
            this,
            ix++,
            x.typeName as keyof Comfy.Signal /* <-- 🔶 this needs to be checked */,
            x.nameInComfy,
         )
         outputs[x.nameInCushy] = output
         this.$outputs.push(output)
         // console.log(`  - .${x.nameInCushy} as ComfyNodeOutput(${ix})`)
      }
      this.outputs = outputs as ComfyNode_output

      // implements the _<typeName> properties (HasSingle interfaces)
      const extensions: { [key: string]: any } = {}
      for (const x of this.$schema.singleOuputs) {
         extensions[`_${x.typeName}`] = outputs[x.nameInCushy]
      }
      Object.assign(this, extensions)
   }

   _convertPromptExtToPrompt(promptExt: ComfyUIAPIRequest_Node): ComfyUIAPIRequest_Node {
      const inputs: { [inputName: string]: any } = {}
      const _done = new Set<string>()
      for (const i of this.$schema.inputs) {
         _done.add(i.nameInComfy)
         const value = this.serializeValue(i.nameInComfy, promptExt.inputs[i.nameInComfy])
         inputs[i.nameInComfy] = value
      }
      for (const [nameInComfy, rawVal] of Object.entries(promptExt.inputs)) {
         if (_done.has(nameInComfy)) continue
         const value = this.serializeValue(nameInComfy, rawVal)
         inputs[nameInComfy] = value
      }
      return { class_type: this.$schema.nameInComfy, inputs }
   }

   /** return the list of nodes piped into this node */
   _incomingNodes(): ComfyNodeId[] {
      const incomingNodes: ComfyNodeId[] = []
      for (const [_name, val] of Object.entries(this.inputs)) {
         if (Array.isArray(val)) {
            const [from, _slotIx] = val
            incomingNodes.push(from)
         }
      }
      return incomingNodes
   }

   _primitives(): { inputName: string; value: string }[] {
      const primitives: { inputName: string; value: string }[] = []
      for (const [inputName, val] of Object.entries(this.inputs)) {
         if (Array.isArray(val)) continue
         primitives.push({ inputName: inputName, value: val?.toString() })
      }
      return primitives
   }

   /** return true if the given node is plugged into this one */
   isChildrenOf(node: ComfyNode<any>): boolean {
      return this._incomingNodes().includes(node.uid)
   }

   get parents(): ComfyNode<any>[] {
      return this._incomingNodes().map((id) => this.graph.getNode(id)!)
   }
   // get children(): ComfyNode<any>[] {
   //     return this._incomingNodes().map((id) => this.graph.getNode(id)!)
   // }

   _visible: boolean = true
   set visible(value: boolean) { this._visible = value } // biome-ignore format: misc
   get visible(): boolean { return this._visible } // biome-ignore format: misc

   _x: number = 0
   get x(): number { return this._x } // biome-ignore format: misc
   set x(value: number) {
      this.isDirty = true
      this._x = value
   }

   _y: number = 0
   get y(): number { return this._y } // biome-ignore format: misc
   set y(value: number) {
      this.isDirty = true
      this._y = value
   }

   isDirty = true

   tagDirty(value: boolean): void {
      this.isDirty = value
   }

   col: number = 0
   selected: boolean = false
   get outgoingPorts(): NodePort[] {
      return this.$outputs.map(
         (o, ix): NodePort => ({
            id: this.uid + '#' + o.slotIx,
            label: o.type,
            width: NodeSlotSize,
            height: NodeSlotSize,
            fromNode: this,
            toNode: o.node ?? undefined,
            type: o.type,
            x: this.x + this.width, // + NodeSlotSize / 2,
            y:
               this.y + //             start
               NodeTitleHeight + //    title
               ix * nodeLineHeight + // e.fromSlotIx * 10,
               nodeLineHeight / 2, //
         }),
      )
   }

   get incomingPorts(): NodePort[] {
      return this._incomingEdges().map(
         (e, ix): NodePort => ({
            id: this.uid + '<-' + e.from + '#' + e.fromSlotIx,
            width: NodeSlotSize,
            height: NodeSlotSize,
            fromNode: this.graph.getNode(e.from) ?? undefined,
            toNode: this,
            label: e.inputName,
            type: e.type,
            x: this.x, // - NodeSlotSize / 2,
            y:
               this.y + // start
               NodeTitleHeight + // title
               ix * nodeLineHeight + // e.fromSlotIx * 10,
               nodeLineHeight / 2,
         }),
      )
   }

   _incomingEdges(): {
      from: ComfyNodeId
      inputName: string
      type: string
      fromSlotIx: number
   }[] {
      const incomingEdges: {
         from: ComfyNodeId
         inputName: string
         fromSlotIx: number
         type: string
      }[] = []

      for (const [inputName, val] of Object.entries(this.inputs)) {
         if (Array.isArray(val)) {
            const [from, _slotIx] = val as [ComfyNodeId, number]
            const type = this.graph.getNode(from)?.$outputs[_slotIx]?.type
            incomingEdges.push({ from, inputName, fromSlotIx: _slotIx, type })
         }
      }
      return incomingEdges
   }

   /** number of primitive fields in this node */
   primitivesCount(): number {
      return Object.values(this.inputs).filter((val) => !Array.isArray(val)).length
   }

   /** width dimensions for autolayout algorithm */
   get width(): number {
      return 200
   }

   /** height dimensions for autolayout algorithm */
   get height(): number {
      const inputLen = this._incomingEdges().length
      const outputLen = this.$schema.outputs.length
      const headerCount = Math.max(inputLen, outputLen)

      // max height since some nodes have many invisible inputs
      return (this.primitivesCount() + headerCount + 1) * nodeLineHeight
   }

   serializeValue(field: string, value: unknown): unknown {
      if (value == null) {
         const schema = this.$schema.inputs.find((i: NodeInputExt) => i.nameInComfy === field)
         if (schema == null) throw new Error(`❌ no schema for field "${field}" (of node ${this.$schema.nameInCushy})`)
         // console.log('def1=', field, schema.opts.default)
         const opts = schema.opts == null || typeof schema.opts !== 'object' ? undefined : schema.opts
         if (opts?.default != null) return opts.default
         // console.log('def2=', field, schema.required)
         if (!schema.required) return undefined
         console.error(field, 'is required but value is ', value, this.json) //, this)
         this.graph.recordProblem(
            `🔴 [serializeValue] field "${field}" (of node ${this.$schema.nameInCushy}#${this.uid}) value is null but field is not optional`,
         )
         return undefined
         // throw new Error(
         //     `🔴 [serializeValue] field "${field}" (of node ${this.$schema.nameInCushy}#${this.uid}) value is null`,
         // )
      }
      if (typeof value === 'function') {
         return this.serializeValue(field, value(this.graph.builder, this.graph))
      }
      if (value === auto_) {
         const expectedType = this._getExpecteTypeForField(field)
         console.info(`🔍 looking for type ${expectedType} for field ${field}`)
         for (const node of this.graph.nodes.slice().reverse()) {
            const output = node._getOutputForTypeOrNull(expectedType)
            if (output != null) return [node.uid, output.slotIx]
         }
         throw new Error(`🔴 [AUTO failed] field "${field}" (of node ${this.$schema.nameInCushy}) value is null`)
      }
      if (value instanceof ComfyNodeOutput) return [value.node.uid, value.slotIx]
      if (value instanceof ComfyNode) {
         const expectedType = this._getExpecteTypeForField(field)
         const output = value._getOutputForTypeOrCrash(expectedType)
         return [value.uid, output.slotIx]
      }
      return value
   }

   private _getExpecteTypeForField(name: string): string {
      const input = this.$schema.inputs.find((i: NodeInputExt) => i.nameInComfy === name)
      if (input == null) throw new Error('🔴 input not found asdf')
      return input.typeName
   }

   private _getOutputForTypeOrCrash(type: string): ComfyNodeOutput<any> {
      const i: NodeOutputExt = this.$schema.outputs.find((i: NodeOutputExt) => i.typeName === type)!
      const val = (this.outputs as any)[i.nameInCushy]
      // console.log(`this[i.name] = ${this.$schema.name}[${i.name}] = ${val}`)
      if (val instanceof ComfyNodeOutput) return val
      throw new Error(`Expected ${i.nameInCushy} to be a ComfyNodeOutput`)
   }

   private _getOutputForTypeOrNull(type: string): ComfyNodeOutput<any> | null {
      const i: Maybe<NodeOutputExt> = this.$schema.outputs.find((i: NodeOutputExt) => i.typeName === type)
      if (i == null) return null
      const val = (this.outputs as any)[i.nameInCushy]
      if (val == null) return null
      if (val instanceof ComfyNodeOutput) return val
      throw new Error(`Expected ${i.nameInCushy} to be a ComfyNodeOutput`)
   }
}
