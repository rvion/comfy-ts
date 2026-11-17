import type { ComfyNode } from 'src/graph/ComfyNode.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import { bang } from 'src/utils/bang.ts'
import {
   classifySchemaInput,
   classifyWidgetInput,
   containerInstanceSlotType,
   defaultValueForWidget,
   type InputWidgetKind,
   type RawInputSpecEntry,
} from 'src/sdk-generator/inputWidgetKind.ts'
import { exhaust } from 'src/utils/exhaust.ts'
import type { LiteGraphJSON } from 'src/litegraph/LiteGraphJSON.ts'
import type { LiteGraphLinkTuple } from 'src/litegraph/LiteGraphLink.ts'
import { asLiteGraphLinkID, type LiteGraphLinkID } from 'src/litegraph/LiteGraphLinkID.ts'
import type { LiteGraphNode } from 'src/litegraph/LiteGraphNode.ts'
import type { LiteGraphNodeInput } from 'src/litegraph/LiteGraphNodeInput.ts'
import type { LiteGraphNodeOutput } from 'src/litegraph/LiteGraphNodeOutput.ts'
import { asLiteGraphSlotIndex } from 'src/litegraph/LiteGraphSlotIndex.ts'

export const convertFlowToLiteGraphJSON = (graph: ComfyWorkflow): LiteGraphJSON => {
   const ctx = new LiteGraphCtx(graph)
   const last_node_id = Math.max(...graph.nodes.map((n) => n.uidNumber))
   const xxx = graph.nodes.map((comfyNode) => ({
      liteGraphNode: convertNodeToLiteGraphNode(ctx, comfyNode),
      comfyNode,
   }))
   for (const xx of xxx) {
      const n = xx.liteGraphNode
      n.pos[0] = bang(xx.comfyNode.x)
      n.pos[1] = bang(xx.comfyNode.y)
      for (const o of n.outputs ?? []) {
         o.links = ctx.links.filter((l) => l[3] === n.id && l[4] === o.slot_index).map((l) => l[0])
      }
   }
   return {
      last_node_id,
      last_link_id: ctx.nextLinkId,
      nodes: xxx.map((n) => n.liteGraphNode),
      links: ctx.links,
      config: {},
      extra: {},
      groups: [],
      version: 0.4,
   }
}

const convertNodeToLiteGraphNode = (ctx: LiteGraphCtx, node: ComfyNode<any>): LiteGraphNode => {
   const inputs: LiteGraphNodeInput[] = []
   const widgets_values: unknown[] = []
   // target_slot = index within THIS node's litegraph inputs array,
   // not the schema input index (widget inputs are not litegraph slots)
   const pushLinked = (
      name: string,
      type: string,
      link: [string, number],
      extra: { shape?: number; widget?: boolean } = {},
   ): void => {
      const nodeUidNumber = bang(
         ctx.graph.nodes.find((n) => n.uid === link[0])?.uidNumber,
         `link target node "${link[0]}" not found in graph`,
      )
      const linkId = ctx.allocateLink(nodeUidNumber, link[1], node.uidNumber, asLiteGraphSlotIndex(inputs.length), type)
      const input: LiteGraphNodeInput = { name, type, link: linkId }
      if (extra.shape != null) input.shape = extra.shape
      if (extra.widget === true) input.widget = { name }
      inputs.push(input)
   }
   /** frontend button-widget values ride BEFORE the real value (LOAD_3D); the control_after_generate
    * phantom AFTER it: the classifier's consumes covers prefix + value + control, config-driven
    * (the 2024 INT-named-seed heuristic lives inside controlConsumes), so export and import can
    * never disagree on the run length */
   const pushWidgetRun = (kind: Extract<InputWidgetKind, { kind: 'widget' }>, raw: unknown, opts: unknown): void => {
      widgets_values.push(...kind.prefixValues, raw)
      const phantoms = kind.consumes - 1 - kind.prefixValues.length
      for (let i = 0; i < phantoms; i++) widgets_values.push(controlMode(opts))
   }
   /** one input, the way the editor saves it: a widget writes its run (a linked one too, with
    * its widget socket, since the editor serializes every widget), a dynamic combo its key then
    * the selected branch inline, a group its row count then the rows, a slot its socket */
   const writeInput = (p: {
      name: string
      kind: InputWidgetKind
      typeName: string
      opts: unknown
      value: unknown
   }): void => {
      const where = `${node.$schema.nameInComfy}#${node.uid} "${p.name}"`
      switch (p.kind.kind) {
         case 'widget':
            if (_isLink(p.value)) {
               pushLinked(p.name, p.typeName, p.value, { widget: true })
               pushWidgetRun(p.kind, defaultValueForWidget({ type: p.typeName, opts: p.opts }), p.opts)
            } else pushWidgetRun(p.kind, p.value, p.opts)
            return
         case 'slot':
            // an unconnected slot is a litegraph socket with no link, NEVER a widget value
            if (_isLink(p.value)) pushLinked(p.name, p.typeName, p.value)
            else inputs.push({ name: p.name, type: p.typeName, link: null })
            return
         case 'dynamic-combo': {
            const kind = p.kind
            const key = typeof p.value === 'string' ? p.value : kind.defaultKey
            const option = kind.options.find((o) => o.key === key)
            if (option == null) throw new Error(`🔴 [toWorkflowJson] ${where}: "${key}" is not one of its options`)
            widgets_values.push(key)
            for (const sub of option.inputs) writeSub(`${p.name}.${sub.name}`, sub)
            return
         }
         case 'dynamic-container': {
            // the declaration is never a slot: each grown instance is its own
            // optional slot `decl.<instance>` (shape 7), as the editor stores it
            const type = containerInstanceSlotType(p.opts) ?? '*'
            for (const instance of p.kind.instanceNames) {
               const name = `${p.name}.${instance}`
               const value = node.json.inputs[name]
               if (value == null) continue
               const raw = node.serializeValue(name, value)
               if (!_isLink(raw))
                  throw new Error(
                     `🔴 [toWorkflowJson] ${where}.${instance} holds a literal; an autogrow instance is a link slot in the editor`,
                  )
               pushLinked(name, type, raw, { shape: 7 })
            }
            return
         }
         case 'dynamic-group': {
            // the editor's run: the row count, then each row's field runs (dynamicGroupWidget.ts)
            const prefix = `${p.name}.`
            let rows = 0
            for (const key of Object.keys(node.json.inputs)) {
               if (!key.startsWith(prefix)) continue
               const row = Number(key.slice(prefix.length).split('.')[0])
               if (Number.isInteger(row) && row >= rows) rows = row + 1
            }
            widgets_values.push(rows)
            for (let row = 0; row < rows; row++)
               for (const field of p.kind.fields) writeSub(`${prefix}${row}.${field.name}`, field)
            return
         }
         default:
            exhaust(p.kind)
      }
   }
   /** a dotted input (dynamic combo branch, group row field): never a schema input, so its absent
    * value is the widget's schema default rather than serializeValue's */
   const writeSub = (name: string, sub: RawInputSpecEntry): void => {
      const typeName = typeof sub.type === 'string' ? sub.type : 'COMBO'
      const raw: unknown = node.json.inputs[name]
      writeInput({
         name,
         kind: classifyWidgetInput({ name: sub.name, type: sub.type, opts: sub.opts }),
         typeName,
         opts: sub.opts,
         value: raw === undefined ? defaultValueForWidget({ type: typeName, opts: sub.opts }) : raw,
      })
   }
   for (const ipt of node.$schema.inputs) {
      const kind = classifySchemaInput(ipt)
      // a dynamic input's own key is never a schema-default value: read it raw
      const raw = node.json.inputs[ipt.nameInComfy]
      const value = kind.kind === 'widget' || kind.kind === 'slot' ? node.serializeValue(ipt.nameInComfy, raw) : raw
      writeInput({ name: ipt.nameInComfy, kind, typeName: ipt.typeName, opts: ipt.opts, value })
   }
   const outputs = node.$schema.outputs.map(
      (i, ix): LiteGraphNodeOutput => ({
         // ❌9 name: i.nameInComfy,
         type: i.typeName,
         links: [], // empty links by default 🔴
         slot_index: asLiteGraphSlotIndex(ix),
         name: i.outKey,
      }),
   )
   return {
      type: node.$schema.nameInComfy,
      id: node.uidNumber,
      inputs,
      outputs,
      pos: [0, 0],
      size: [node.width, node.height],
      widgets_values,
   }
}

/** the editor's control widget is a combo (fixed, increment, decrement, randomize):
 * a config naming a mode keeps it, anything else is `fixed`, the seed the code pinned */
const controlMode = (opts: unknown): string => {
   const mode = typeof opts === 'object' && opts != null ? Reflect.get(opts, 'control_after_generate') : null
   return typeof mode === 'string' ? mode : 'fixed'
}

const _isLink = (v: unknown): v is [string, number] => {
   return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number'
}

export class LiteGraphCtx {
   constructor(public graph: ComfyWorkflow) {}
   nextLinkId: number = 0
   links: LiteGraphLinkTuple[] = []
   allocateLink = (
      fromNodeId: number,
      fromNodeOutputIx: number,
      toNodeId: number,
      toNodeInputIx: number,
      linkType: string,
   ): LiteGraphLinkID => {
      const linkId = asLiteGraphLinkID(++this.nextLinkId)
      this.links.push([linkId, fromNodeId, fromNodeOutputIx, toNodeId, toNodeInputIx, linkType])
      return linkId
   }
}
