import { type } from 'arktype'
import type {
   CanonicalGroup,
   CanonicalInput,
   CanonicalLink,
   CanonicalNode,
   CanonicalOutput,
   CanonicalWidgetValues,
   CanonicalWorkflow,
   NodeMode,
} from 'src/litegraph/CanonicalWorkflow.ts'
import { type CanonicalSubgraphDef, expandSubgraphs } from 'src/litegraph/expandSubgraphs.ts'
import type { LiteGraphGroup } from 'src/litegraph/LiteGraphGroup.ts'
import { type LiteGraphJSON, LiteGraphJSON_ark } from 'src/litegraph/LiteGraphJSON.ts'
import type { LiteGraphLink } from 'src/litegraph/LiteGraphLink.ts'
import type { LiteGraphNode } from 'src/litegraph/LiteGraphNode.ts'
import type { LiteGraphNodeInput } from 'src/litegraph/LiteGraphNodeInput.ts'
import type { LiteGraphNodeOutput } from 'src/litegraph/LiteGraphNodeOutput.ts'
import type { LiteGraphSubgraphDef } from 'src/litegraph/LiteGraphSubgraphDef.ts'

export type WorkflowNormalizeErrorCode = 'schema-reject' | 'subgraph-cycle' | 'subgraph-io-mismatch' | 'bad-document'

/** a workflow JSON we cannot turn into a CanonicalWorkflow — loud, typed, never a cast */
export class WorkflowNormalizeError extends Error {
   constructor(
      public code: WorkflowNormalizeErrorCode,
      message: string,
      public detail?: unknown,
   ) {
      super(`[workflow ${code}] ${message}`)
      this.name = 'WorkflowNormalizeError'
   }
}

/**
 * THE one entry for foreign workflow JSON (files, clipboard, imports):
 * tolerant ark validation, then normalization to the strict canonical shape.
 */
export const parseWorkflowJson = (json: unknown): CanonicalWorkflow => {
   const out = LiteGraphJSON_ark(json)
   if (out instanceof type.errors) throw new WorkflowNormalizeError('schema-reject', out.summary, out)
   return normalizeWorkflow(out)
}

/**
 * loose wire document → strict canonical document. Defaults filled, both link
 * eras unified, cosmetic fields dropped, subgraph definitions expanded away
 * (see expandSubgraphs.ts — def interiors go through the SAME per-shape
 * normalizers, they are v1 bodies).
 */
export const normalizeWorkflow = (raw: LiteGraphJSON): CanonicalWorkflow => {
   const wf: CanonicalWorkflow = {
      nodes: raw.nodes.map(normalizeNode),
      links: raw.links.map(normalizeLink),
      groups: (raw.groups ?? []).map(normalizeGroup),
   }
   const rawDefs = raw.definitions?.subgraphs ?? []
   if (rawDefs.length === 0) return wf
   const defs = new Map<string, CanonicalSubgraphDef>()
   for (const d of rawDefs) defs.set(d.id, normalizeSubgraphDef(d))
   return expandSubgraphs(wf, defs)
}

const normalizeSubgraphDef = (d: LiteGraphSubgraphDef): CanonicalSubgraphDef => {
   return {
      id: d.id,
      name: d.name,
      inputs: d.inputs.map((io) => ({ name: io.name, type: io.type })),
      outputs: d.outputs.map((io) => ({ name: io.name, type: io.type })),
      nodes: d.nodes.map(normalizeNode),
      links: d.links.map(normalizeLink),
   }
}

const normalizeMode = (mode: number | undefined): NodeMode => {
   if (mode === 2) return 'muted'
   if (mode === 4) return 'bypassed'
   return 'normal' // 0 (always) / 1 (on-event) / 3 (on-trigger) all execute
}

const normalizeNode = (n: LiteGraphNode): CanonicalNode => {
   return {
      id: n.id,
      type: n.type,
      title: n.title ?? null,
      mode: normalizeMode(n.mode),
      isVirtualNode: n.isVirtualNode ?? false,
      inputs: (n.inputs ?? []).map(normalizeInput),
      outputs: (n.outputs ?? []).map(normalizeOutput),
      widgets: normalizeWidgetValues(n.widgets_values),
      pos: [n.pos[0], n.pos[1]],
      size: [n.size[0], n.size[1]],
      properties: { ...n.properties },
   }
}

const normalizeInput = (i: LiteGraphNodeInput): CanonicalInput => {
   return {
      name: i.name,
      type: i.type,
      link: i.link ?? null,
      widgetName: i.widget?.name ?? null,
   }
}

const normalizeOutput = (o: LiteGraphNodeOutput): CanonicalOutput => {
   return {
      name: o.name,
      type: o.type,
      links: [...(o.links ?? [])],
   }
}

const normalizeWidgetValues = (wv: unknown[] | Record<string, unknown> | undefined): CanonicalWidgetValues => {
   if (wv == null) return { positional: [], named: {} }
   if (Array.isArray(wv)) return { positional: [...wv], named: {} }
   return { positional: [], named: { ...wv } }
}

const normalizeLink = (l: LiteGraphLink): CanonicalLink => {
   if (Array.isArray(l)) {
      return { id: l[0], originId: l[1], originSlot: l[2], targetId: l[3], targetSlot: l[4], type: l[5] }
   }
   return {
      id: l.id,
      originId: l.origin_id,
      originSlot: l.origin_slot,
      targetId: l.target_id,
      targetSlot: l.target_slot,
      type: l.type,
   }
}

const normalizeGroup = (g: LiteGraphGroup): CanonicalGroup => {
   return {
      title: g.title,
      bounding: [g.bounding[0], g.bounding[1], g.bounding[2], g.bounding[3]],
      color: g.color ?? '#3f789e',
      fontSize: g.font_size ?? 24,
   }
}
