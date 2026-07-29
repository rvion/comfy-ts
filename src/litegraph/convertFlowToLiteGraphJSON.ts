import type { ComfyNode } from 'src/graph/ComfyNode.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import { bang } from 'src/utils/bang.ts'
import { howManyWidgetValuesForThisSchemaType } from 'src/sdk-generator/Primitives.ts'
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
   for (const ipt of node.$schema.inputs) {
      const raw = node.serializeValue(ipt.nameInComfy, node.json.inputs[ipt.nameInComfy])
      const isWidget = howManyWidgetValuesForThisSchemaType(ipt) > 0
      if (_isLink(raw)) {
         const nodeUidNumber = bang(
            ctx.graph.nodes.find((n) => n.uid === raw[0])?.uidNumber,
            `link target node "${raw[0]}" not found in graph`,
         )
         inputs.push({
            name: ipt.nameInComfy,
            type: ipt.typeName,
            // target_slot = index within THIS node's litegraph inputs array,
            // not the schema input index (widget inputs are not litegraph slots)
            link: ctx.allocateLink(
               nodeUidNumber,
               raw[1],
               node.uidNumber,
               asLiteGraphSlotIndex(inputs.length),
               ipt.typeName,
            ),
         })
      } else if (isWidget) {
         widgets_values.push(raw)
         // ComfyUI stores a phantom control_after_generate value after seeds
         const isSeed = ipt.typeName === 'INT' && (ipt.nameInComfy === 'seed' || ipt.nameInComfy === 'noise_seed')
         if (isSeed) widgets_values.push(false)
      } else {
         // unconnected link-kind input: a litegraph slot with no link —
         // NEVER a widget value (that would misalign the round-trip import)
         inputs.push({ name: ipt.nameInComfy, type: ipt.typeName, link: null })
      }
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
