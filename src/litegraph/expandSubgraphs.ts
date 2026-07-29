import type { CanonicalLink, CanonicalNode, CanonicalWorkflow } from 'src/litegraph/CanonicalWorkflow.ts'
import { asLiteGraphLinkID, type LiteGraphLinkID } from 'src/litegraph/LiteGraphLinkID.ts'
import { WorkflowNormalizeError } from 'src/litegraph/normalizeWorkflow.ts'
import { bang } from 'src/utils/bang.ts'

/** one exposed slot of a normalized subgraph definition */
export type CanonicalSubgraphIO = {
   name: string
   type: string
}

/** a subgraph definition normalized by the SAME per-node/per-link normalizers as the root */
export type CanonicalSubgraphDef = {
   id: string // uuid, referenced by instance nodes' `type`
   name: string
   inputs: CanonicalSubgraphIO[]
   outputs: CanonicalSubgraphIO[]
   nodes: CanonicalNode[]
   links: CanonicalLink[]
}

/** boundary sentinel ids inside definition link tables */
const SUBGRAPH_INPUT_NODE_ID = -10
const SUBGRAPH_OUTPUT_NODE_ID = -20

/** 48 corpus files nest defs inside defs; a self-referencing def would loop forever */
const MAX_EXPANSION_PASSES = 32

/**
 * widget-kind fallback when a def input slot has no boundary target carrying a
 * widget marker: these litegraph slot types carry widget values. LOCAL copy on
 * purpose — the sdk-generator's seed-consumes-2 arithmetic does not apply here
 * (the io-widget era serializes exactly one value per exposed widget slot).
 */
const PRIMITIVE_WIDGET_TYPES: ReadonlySet<string> = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'])

/**
 * inline every subgraph instance (node whose `type` is a definition uuid) into
 * the root graph: fresh numeric ids, boundary links rewired, instance widget
 * values promoted into the inner nodes' `named` overrides. Iterative so nested
 * definitions expand on the next pass. Muted instances are dropped (their
 * consumers resolve unconnected); bypassed instances stay for the converter's
 * passthrough walk, which needs no interior.
 */
export const expandSubgraphs = (wf: CanonicalWorkflow, defs: Map<string, CanonicalSubgraphDef>): CanonicalWorkflow => {
   let passes = 0
   while (true) {
      const expandable = wf.nodes.filter((n) => defs.has(n.type) && n.mode !== 'bypassed')
      if (expandable.length === 0) return wf
      if (++passes > MAX_EXPANSION_PASSES)
         throw new WorkflowNormalizeError(
            'subgraph-cycle',
            `subgraph expansion did not terminate after ${MAX_EXPANSION_PASSES} passes — self-referencing definitions?`,
         )
      for (const instance of expandable) {
         if (instance.mode === 'muted') dropMutedInstance(wf, instance)
         else expandOneInstance(wf, instance, bang(defs.get(instance.type)))
      }
   }
}

/** converter mute semantics applied early: after expansion there is no single node left to skip */
const dropMutedInstance = (wf: CanonicalWorkflow, instance: CanonicalNode): void => {
   const dead = new Set<LiteGraphLinkID>()
   for (const link of wf.links) {
      if (link.originId === instance.id || link.targetId === instance.id) dead.add(link.id)
   }
   wf.links = wf.links.filter((l) => !dead.has(l.id))
   wf.nodes = wf.nodes.filter((n) => n.id !== instance.id)
   pruneDeadLinkRefs(wf, dead)
}

const pruneDeadLinkRefs = (wf: CanonicalWorkflow, dead: ReadonlySet<LiteGraphLinkID>): void => {
   if (dead.size === 0) return
   for (const node of wf.nodes) {
      for (const input of node.inputs) {
         if (input.link != null && dead.has(input.link)) input.link = null
      }
      for (const output of node.outputs) {
         output.links = output.links.filter((id) => !dead.has(id))
      }
   }
}

const expandOneInstance = (wf: CanonicalWorkflow, instance: CanonicalNode, def: CanonicalSubgraphDef): void => {
   // 1. fresh numeric ids, deterministic (def node order / def link order)
   let nextNodeId = Math.max(0, ...wf.nodes.map((n) => n.id))
   let nextLinkId = Math.max(0, ...wf.links.map((l) => l.id))
   const newNodeIds = new Map<number, number>()
   for (const inner of def.nodes) newNodeIds.set(inner.id, ++nextNodeId)
   // null = the def link references a node the def does not contain: upstream
   // editors leave STALE links behind after node deletion (corpus-verified,
   // e.g. utility_video_upscale) and the frontend prunes them on load. We drop
   // the link; the consumer resolves unconnected, loud at conversion when required.
   const remapNodeId = (id: number): number | null => newNodeIds.get(id) ?? null

   // 2. instance input slot → def input slot, BY NAME (instances may serialize
   // a subset of the def's inputs). A name matching NO def input is LOUD:
   // silently falling back to the positional index would wire the outer feed
   // into the wrong inner slot (corpus-absent today, so a throw is safe)
   const defSlotOfInstanceSlot = new Map<number, number>()
   for (const [k, input] of instance.inputs.entries()) {
      const defSlot = def.inputs.findIndex((d) => d.name === input.name)
      if (defSlot < 0)
         throw new WorkflowNormalizeError(
            'subgraph-io-mismatch',
            `subgraph instance ${instance.id}(${def.name}): input "${input.name}" (slot ${k}) matches no definition input (defined: ${def.inputs.map((d) => d.name).join(', ')})`,
         )
      defSlotOfInstanceSlot.set(k, defSlot)
   }

   // 3. outer links INTO the instance, keyed by def input slot
   const outerLinkIntoDefSlot = new Map<number, CanonicalLink>()
   for (const link of wf.links) {
      if (link.targetId !== instance.id) continue
      const defSlot = defSlotOfInstanceSlot.get(link.targetSlot)
      if (defSlot == null)
         throw new WorkflowNormalizeError(
            'subgraph-io-mismatch',
            `subgraph instance ${instance.id}(${def.name}): link ${link.id} targets undeclared instance slot ${link.targetSlot}`,
         )
      outerLinkIntoDefSlot.set(defSlot, link)
   }

   // 4. classify definition links: plain interior links clone with fresh ids;
   // input-boundary links (-10 origin) become real links from the outer origin
   // when one exists (else they drop and the inner target falls back to its own
   // widget values); output-boundary links (-20 target) just name the inner
   // producer each def output slot maps to.
   const newLinkIds = new Map<LiteGraphLinkID, LiteGraphLinkID>()
   const splicedLinks: CanonicalLink[] = []
   const producerByOutSlot = new Map<number, { nodeId: number; slot: number }>()
   const passthroughOutSlot = new Map<number, number>() // def out slot → def in slot (-10 → -20 direct)
   const boundaryTargetsByInSlot = new Map<number, { nodeId: number; slot: number }[]>() // remapped inner targets
   for (const link of def.links) {
      const fromInputBoundary = link.originId === SUBGRAPH_INPUT_NODE_ID
      const toOutputBoundary = link.targetId === SUBGRAPH_OUTPUT_NODE_ID
      if (fromInputBoundary && toOutputBoundary) {
         passthroughOutSlot.set(link.targetSlot, link.originSlot)
         continue
      }
      if (toOutputBoundary) {
         const producerId = remapNodeId(link.originId)
         if (producerId != null && !producerByOutSlot.has(link.targetSlot))
            producerByOutSlot.set(link.targetSlot, { nodeId: producerId, slot: link.originSlot })
         continue
      }
      if (fromInputBoundary) {
         const targetId = remapNodeId(link.targetId)
         if (targetId == null) continue
         const target = { nodeId: targetId, slot: link.targetSlot }
         const targets = boundaryTargetsByInSlot.get(link.originSlot) ?? []
         targets.push(target)
         boundaryTargetsByInSlot.set(link.originSlot, targets)
         const outer = outerLinkIntoDefSlot.get(link.originSlot)
         if (outer == null) continue // no outer feed: inner target's input.link nulls at clone time
         const fresh = asLiteGraphLinkID(++nextLinkId)
         newLinkIds.set(link.id, fresh)
         splicedLinks.push({
            id: fresh,
            originId: outer.originId,
            originSlot: outer.originSlot,
            targetId: target.nodeId,
            targetSlot: target.slot,
            type: link.type,
         })
         const originNode = wf.nodes.find((n) => n.id === outer.originId)
         originNode?.outputs[outer.originSlot]?.links.push(fresh)
         continue
      }
      const interiorOrigin = remapNodeId(link.originId)
      const interiorTarget = remapNodeId(link.targetId)
      if (interiorOrigin == null || interiorTarget == null) continue
      const fresh = asLiteGraphLinkID(++nextLinkId)
      newLinkIds.set(link.id, fresh)
      splicedLinks.push({
         id: fresh,
         originId: interiorOrigin,
         originSlot: link.originSlot,
         targetId: interiorTarget,
         targetSlot: link.targetSlot,
         type: link.type,
      })
   }

   // 5. clone inner nodes with remapped ids; link refs not in newLinkIds were
   // dropped boundary links → null (the node falls back to its widget values)
   const splicedNodes: CanonicalNode[] = def.nodes.map((inner) => ({
      id: bang(newNodeIds.get(inner.id)),
      type: inner.type,
      title: inner.title,
      mode: inner.mode,
      isVirtualNode: inner.isVirtualNode,
      inputs: inner.inputs.map((i) => ({
         name: i.name,
         type: i.type,
         link: i.link != null ? (newLinkIds.get(i.link) ?? null) : null,
         widgetName: i.widgetName,
      })),
      outputs: inner.outputs.map((o) => ({
         name: o.name,
         type: o.type,
         links: o.links.map((id) => newLinkIds.get(id)).filter((id): id is LiteGraphLinkID => id != null),
      })),
      widgets: { positional: [...inner.widgets.positional], named: { ...inner.widgets.named } },
      pos: [inner.pos[0], inner.pos[1]],
      size: [inner.size[0], inner.size[1]],
      properties: { ...inner.properties },
   }))

   // 6. rewire root links FROM the instance's outputs onto the inner producers;
   // outer links INTO the instance were consumed by step 4
   const dead = new Set<LiteGraphLinkID>()
   for (const link of wf.links) {
      if (link.targetId === instance.id) {
         dead.add(link.id)
         continue
      }
      if (link.originId !== instance.id) continue
      const producer = producerByOutSlot.get(link.originSlot)
      if (producer != null) {
         link.originId = producer.nodeId
         link.originSlot = producer.slot
         const producerNode = splicedNodes.find((n) => n.id === producer.nodeId)
         producerNode?.outputs[producer.slot]?.links.push(link.id)
         continue
      }
      const passthroughInSlot = passthroughOutSlot.get(link.originSlot)
      const outer = passthroughInSlot != null ? outerLinkIntoDefSlot.get(passthroughInSlot) : null
      if (outer != null) {
         link.originId = outer.originId
         link.originSlot = outer.originSlot
         continue
      }
      dead.add(link.id) // def output has no producer: consumers resolve unconnected
   }
   wf.links = wf.links.filter((l) => !dead.has(l.id))
   pruneDeadLinkRefs(wf, dead)

   // 7. widget promotion (both serialization eras), then splice
   promoteInstanceWidgets(instance, def, splicedNodes, newNodeIds, boundaryTargetsByInSlot)
   wf.nodes = wf.nodes.filter((n) => n.id !== instance.id)
   wf.nodes.push(...splicedNodes)
   wf.links.push(...splicedLinks)
}

/**
 * instance widget values land in inner nodes' `named` overrides. TWO eras for
 * the POSITIONAL values:
 * - proxyWidgets era: `properties.proxyWidgets` pairs [innerNodeId, widgetName]
 *   zip against the instance's positional values (incl. `control_after_generate`
 *   phantom pairs — written to `named` and simply never read, no schema input
 *   has that name).
 * - io-widget era (no proxyWidgets): positional values zip against the def's
 *   widget-kind input slots in def order, one value per slot (no phantom —
 *   corpus-verified). An outer link into the same slot wins in the converter;
 *   the named override is still written, matching ComfyUI.
 * PLUS, in both eras, NAMED overrides on the instance keyed by def-input name:
 * that is how a NESTED instance receives its outer values (the previous pass
 * wrote them to `named`), so they must forward through THIS expansion too —
 * named wins over positional, same precedence as the converter.
 */
const promoteInstanceWidgets = (
   instance: CanonicalNode,
   def: CanonicalSubgraphDef,
   splicedNodes: CanonicalNode[],
   newNodeIds: Map<number, number>,
   boundaryTargetsByInSlot: Map<number, { nodeId: number; slot: number }[]>,
): void => {
   const promoteToSlotTargets = (slot: number, value: unknown): void => {
      for (const t of boundaryTargetsByInSlot.get(slot) ?? []) {
         const target = splicedNodes.find((n) => n.id === t.nodeId)
         const input = innerInputAt(splicedNodes, t)
         if (target == null || input == null) continue
         target.widgets.named[input.name] = value
      }
   }

   promotePositionalWidgets(instance, def, splicedNodes, newNodeIds, boundaryTargetsByInSlot, promoteToSlotTargets)

   for (const [slot, io] of def.inputs.entries()) {
      if (!Object.hasOwn(instance.widgets.named, io.name)) continue
      promoteToSlotTargets(slot, instance.widgets.named[io.name])
   }
}

const promotePositionalWidgets = (
   instance: CanonicalNode,
   def: CanonicalSubgraphDef,
   splicedNodes: CanonicalNode[],
   newNodeIds: Map<number, number>,
   boundaryTargetsByInSlot: Map<number, { nodeId: number; slot: number }[]>,
   promoteToSlotTargets: (slot: number, value: unknown) => void,
): void => {
   const values = instance.widgets.positional
   if (values.length === 0) return // inner nodes keep their serialized defaults

   const proxy = instance.properties['proxyWidgets']
   if (Array.isArray(proxy) && proxy.length > 0) {
      const count = Math.min(values.length, proxy.length)
      for (let k = 0; k < count; k++) {
         const pair: unknown = proxy[k]
         if (!Array.isArray(pair) || pair.length !== 2)
            throw new WorkflowNormalizeError(
               'subgraph-io-mismatch',
               `subgraph instance ${instance.id}(${def.name}): malformed proxyWidgets entry ${JSON.stringify(pair)}`,
            )
         const innerId = Number(pair[0])
         const widgetName = String(pair[1])
         if (innerId < 0) {
            // id -1 names a widget on the subgraph node ITSELF (a promoted io
            // widget): route the value through the matching def input slot
            const slot = def.inputs.findIndex((d) => d.name === widgetName)
            if (slot < 0)
               throw new WorkflowNormalizeError(
                  'subgraph-io-mismatch',
                  `subgraph instance ${instance.id}(${def.name}): proxyWidgets pair ${k} names io widget "${widgetName}" but no definition input matches`,
               )
            promoteToSlotTargets(slot, values[k])
            continue
         }
         const target = splicedNodes.find((n) => n.id === newNodeIds.get(innerId))
         if (target == null)
            throw new WorkflowNormalizeError(
               'subgraph-io-mismatch',
               `subgraph instance ${instance.id}(${def.name}): proxyWidgets pair ${k} names unknown inner node ${String(pair[0])}`,
            )
         target.widgets.named[widgetName] = values[k]
      }
      return
   }

   let valueIndex = 0
   for (const [slot, io] of def.inputs.entries()) {
      const targets = boundaryTargetsByInSlot.get(slot) ?? []
      const isWidgetSlot =
         targets.length > 0
            ? targets.some((t) => innerInputAt(splicedNodes, t)?.widgetName != null)
            : PRIMITIVE_WIDGET_TYPES.has(io.type)
      if (!isWidgetSlot) continue
      if (valueIndex >= values.length) break
      promoteToSlotTargets(slot, values[valueIndex++])
   }
}

const innerInputAt = (
   splicedNodes: CanonicalNode[],
   t: { nodeId: number; slot: number },
): { name: string; widgetName: string | null } | null => {
   const node = splicedNodes.find((n) => n.id === t.nodeId)
   return node?.inputs[t.slot] ?? null
}
