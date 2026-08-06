import type { ComfyWorkflow, ProgressReport } from 'src/runner/ComfyWorkflow.ts'
import type { NodeProgress } from 'src/runner/ComfyWsApi.ts'
import type { ComfyNodeSchema } from 'src/sdk-generator/ComfyNodeSchema.ts'
import type { ComfyApiNodeJson } from 'src/sdk-generator/comfy-api-json.ts'
import type { NodeInputExt, NodeOutputExt } from 'src/sdk-generator/comfyui-types.ts'
import { ComfyDefaultNodeWhenUnknown_Name } from 'src/sdk-generator/Primitives.ts'
import { classifySchemaInput, defaultValueForWidget } from 'src/sdk-generator/inputWidgetKind.ts'
import type { DynamicComboOption } from 'src/sdk-generator/inputWidgetKind.ts'
import type { Maybe } from 'src/types/index.ts'
import { comfyColors } from 'src/utils/ComfyColors.ts'
import { auto_ } from 'src/graph/autoValue.ts'
import type { ComfyNodeId, ComfyNodeMetadata } from 'src/graph/ComfyNodeID.ts'
import { ComfyNodeOutput } from 'src/graph/ComfyNodeOutput.ts'
import { NodeSlotSize, NodeTitleHeight, nodeLineHeight } from 'src/graph/NodeSlotSize.ts'

type NodeExecutionStatus = 'executing' | 'done' | 'error' | 'waiting' | 'cached' | null

const isScalarValue = (x: unknown): x is string | number | boolean =>
   typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'

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

   $schema: ComfyNodeSchema
   updatedAt: number = Date.now()
   json: ComfyApiNodeJson

   get isExecuting(): boolean {
      return this.status === 'executing'
   }

   disabled: boolean = false

   disable(): void {
      this.disabled = true
   }

   get inputs(): ComfyNode_input {
      // sanctioned cast (agent/coding.md): runtime graph json <-> generated
      // static face; both derive from the same object_info
      return this.json.inputs as ComfyNode_input
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
   $outputs: ComfyNodeOutput<string>[] = []
   outputs: ComfyNode_output
   uidPrefixed: string

   constructor(
      public graph: ComfyWorkflow,
      public uid: ComfyNodeUID, //  = graph.getUID(),
      jsonExt: ComfyApiNodeJson,
      public meta: ComfyNodeMetadata = {},
   ) {
      // strictly-numeric uids keep uid === uidNumber (litegraph export must agree
      // with prompt keys); anything else gets the next free number ('12abc' must
      // NOT partial-parse to 12 — that collides with node '12')
      const parsedUid = /^\d+$/.test(uid) ? Number(uid) : Number.NaN
      this.uidNumber = Number.isNaN(parsedUid) ? this.graph._uidNumber++ : parsedUid
      if (this.uidNumber >= this.graph._uidNumber) this.graph._uidNumber = this.uidNumber + 1
      if (jsonExt == null) throw new Error('invariant violation: jsonExt is null')
      // this.json = graph.data.apiJson[uid]
      // if (this.json == null) graph.data.apiJson = {}
      // console.log('CONSTRUCTING', xxx.class_type, uid)

      // this.uidNumber = parseInt(uid) // 🔴 ugly
      const exactSchema = graph.schema.nodesByNameInComfy[jsonExt.class_type]
      if (exactSchema == null) {
         // loud fallback: imported json referencing a node this host doesn't have
         graph.recordProblem(
            `unknown node type "${jsonExt.class_type}" — schema fallback to ${ComfyDefaultNodeWhenUnknown_Name}; install the missing custom node on the host`,
         )
      }
      this.$schema = exactSchema ?? graph.schema.nodesByNameInComfy[ComfyDefaultNodeWhenUnknown_Name]!

      if (this.$schema == null) {
         console.log(`❌ available nodes:`, Object.keys(graph.schema.nodesByNameInComfy).join(','))
         throw new Error(`❌ no schema found for node "${jsonExt.class_type}"`)
         // throw new Error('')
      }
      this.uidPrefixed = `${this.$schema.nodeKey}_${this.uidNumber}`
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
         const output = new ComfyNodeOutput(this, ix++, x.typeName, x.nameInComfy)
         outputs[x.outKey] = output
         this.$outputs.push(output)
         // console.log(`  - .${x.outKey} as ComfyNodeOutput(${ix})`)
      }
      this.outputs = outputs as ComfyNode_output

      // implements the _<typeName> properties (HasSingle interfaces)
      const extensions: { [key: string]: any } = {}
      for (const x of this.$schema.singleOutputs) {
         extensions[`_${x.typeName}`] = outputs[x.outKey]
      }
      Object.assign(this, extensions)
   }

   _convertPromptExtToPrompt(promptExt: ComfyApiNodeJson): ComfyApiNodeJson {
      const inputs: { [inputName: string]: any } = {}
      const _done = new Set<string>()
      /** every dotted key of every branch: the selected ones are written here, the rest are dropped */
      const _comboBranchKeys = new Set<string>()
      for (const i of this.$schema.inputs) {
         _done.add(i.nameInComfy)
         const kind = classifySchemaInput(i)
         if (kind.kind === 'dynamic-combo') {
            this._writeDynamicCombo({
               name: i.nameInComfy,
               options: kind.options,
               defaultKey: kind.defaultKey,
               provided: promptExt.inputs,
               out: inputs,
               claimed: _comboBranchKeys,
            })
            continue
         }
         const value = this.serializeValue(i.nameInComfy, promptExt.inputs[i.nameInComfy])
         // absent optionals (autogrow containers included) stay OUT of the
         // prompt: an `undefined` value would already be dropped by JSON
         // serialization, keeping the key would only lie to Object.keys
         if (value !== undefined) inputs[i.nameInComfy] = value
      }
      for (const [nameInComfy, rawVal] of Object.entries(promptExt.inputs)) {
         if (_done.has(nameInComfy) || _comboBranchKeys.has(nameInComfy)) continue
         const value = this.serializeValue(nameInComfy, rawVal)
         inputs[nameInComfy] = value
      }
      return { class_type: this.$schema.nameInComfy, inputs }
   }

   /** dynamic combo → the key plus ONLY the selected branch's dotted inputs, absent ones
    * filled from the schema (agent/architecture.md, dynamic-combo fill). The host declares
    * those branch inputs required and default-fills none of them */
   private _writeDynamicCombo(p: {
      name: string
      options: DynamicComboOption[]
      defaultKey: string
      provided: { [k: string]: unknown }
      out: { [k: string]: any }
      claimed: Set<string>
   }): void {
      for (const opt of p.options) for (const e of opt.inputs) p.claimed.add(`${p.name}.${e.name}`)
      const raw = p.provided[p.name]
      const key = typeof raw === 'string' ? raw : p.defaultKey
      const branch = p.options.find((o) => o.key === key)
      if (branch == null) {
         const known = p.options.map((o) => o.key).join(', ')
         console.error(`🔴 unknown "${p.name}" option ${JSON.stringify(key)} (known: ${known})`)
         this.graph.recordProblem(
            `🔴 unknown "${p.name}" option ${JSON.stringify(key)} on ${this.$schema.nodeKey}#${this.uid} (known: ${known})`,
         )
         return
      }
      p.out[p.name] = key
      for (const e of branch.inputs) {
         const dotted = `${p.name}.${e.name}`
         const given = p.provided[dotted]
         p.out[dotted] =
            given === undefined
               ? defaultValueForWidget({
                    type: typeof e.type === 'string' ? e.type : 'COMBO',
                    opts: e.opts,
                    enumValues: Array.isArray(e.type) ? e.type.filter(isScalarValue) : undefined,
                 })
               : this.serializeValue(dotted, given)
      }
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
   set visible(value: boolean) {
      this._visible = value
   } // biome-ignore format: misc
   get visible(): boolean {
      return this._visible
   } // biome-ignore format: misc

   _x: number = 0
   get x(): number {
      return this._x
   } // biome-ignore format: misc
   set x(value: number) {
      this.isDirty = true
      this._x = value
   }

   _y: number = 0
   get y(): number {
      return this._y
   } // biome-ignore format: misc
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
            const type = this.graph.getNode(from)?.$outputs[_slotIx]?.type ?? 'UNKNOWN'
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
         if (schema == null) throw new Error(`❌ no schema for field "${field}" (of node ${this.$schema.nodeKey})`)
         // console.log('def1=', field, schema.opts.default)
         const opts = schema.opts == null || typeof schema.opts !== 'object' ? undefined : schema.opts
         if (opts?.default != null) return opts.default
         // console.log('def2=', field, schema.required)
         if (!schema.required) return undefined
         console.error(field, 'is required but value is ', value, this.json) //, this)
         this.graph.recordProblem(
            `🔴 [serializeValue] field "${field}" (of node ${this.$schema.nodeKey}#${this.uid}) value is null but field is not optional`,
         )
         return undefined
         // throw new Error(
         //     `🔴 [serializeValue] field "${field}" (of node ${this.$schema.nodeKey}#${this.uid}) value is null`,
         // )
      }
      if (typeof value === 'function') {
         return this.serializeValue(field, value(this.graph.builder, this.graph))
      }
      if (value === auto_) {
         const expectedType = this._getExpectedTypeForField(field)
         console.info(`🔍 looking for type ${expectedType} for field ${field}`)
         for (const node of this.graph.nodes.slice().reverse()) {
            const output = node._getOutputForTypeOrNull(expectedType)
            if (output != null) return [node.uid, output.slotIx]
         }
         throw new Error(`🔴 [AUTO failed] field "${field}" (of node ${this.$schema.nodeKey}) value is null`)
      }
      if (value instanceof ComfyNodeOutput) return [value.node.uid, value.slotIx]
      if (value instanceof ComfyNode) {
         const expectedType = this._getExpectedTypeForField(field)
         const output = value._getOutputForTypeOrCrash(expectedType)
         return [value.uid, output.slotIx]
      }
      return value
   }

   private _getExpectedTypeForField(name: string): string {
      const input = this.$schema.inputs.find((i: NodeInputExt) => i.nameInComfy === name)
      if (input == null) throw new Error('🔴 input not found asdf')
      return input.typeName
   }

   private _getOutputForTypeOrCrash(type: string): ComfyNodeOutput<any> {
      const i: NodeOutputExt = this.$schema.outputs.find((i: NodeOutputExt) => i.typeName === type)!
      const val = (this.outputs as any)[i.outKey]
      // console.log(`this[i.name] = ${this.$schema.name}[${i.name}] = ${val}`)
      if (val instanceof ComfyNodeOutput) return val
      throw new Error(`Expected ${i.outKey} to be a ComfyNodeOutput`)
   }

   private _getOutputForTypeOrNull(type: string): ComfyNodeOutput<any> | null {
      const i: Maybe<NodeOutputExt> = this.$schema.outputs.find((i: NodeOutputExt) => i.typeName === type)
      if (i == null) return null
      const val = (this.outputs as any)[i.outKey]
      if (val == null) return null
      if (val instanceof ComfyNodeOutput) return val
      throw new Error(`Expected ${i.outKey} to be a ComfyNodeOutput`)
   }
}
