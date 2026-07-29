import { type } from 'arktype'
import type { EmptyRecord, IsEqual } from 'src/types/index.ts'
import { type LiteGraphGroup, LiteGraphGroup_ark } from 'src/litegraph/LiteGraphGroup.ts'
import { type LiteGraphLink, LiteGraphLink_ark } from 'src/litegraph/LiteGraphLink.ts'
import { type LiteGraphNode, LiteGraphNode_ark } from 'src/litegraph/LiteGraphNode.ts'
import { type LiteGraphSubgraphDef, LiteGraphSubgraphDef_ark } from 'src/litegraph/LiteGraphSubgraphDef.ts'

/** comfy workflows are simply LiteGraphs workflows */
export type ComfyWorkflowJSON = LiteGraphJSON

/**
 * litegraph workflow root, TOLERANT: models what upstream actually serializes
 * across eras — v0.4 (tuple links, last_*_id) and v1 (object links, `state`),
 * including hybrid files (v0.4 root + v1-shaped subgraph definitions).
 * Downstream code never reads this shape: `normalizeWorkflow` turns it into
 * the strict `CanonicalWorkflow`.
 */
export type LiteGraphJSON = {
   id?: string // uuid (newer serializers)
   revision?: number
   last_node_id?: number // v0.4 (recomputable, absent in v1)
   last_link_id?: number // v0.4
   state?: Record<string, unknown> // v1: {lastNodeId, lastLinkId, …}
   nodes: LiteGraphNode[]
   links: LiteGraphLink[]
   groups?: LiteGraphGroup[]
   config?: EmptyRecord
   extra?: {
      ds?: {
         scale: number
         offset: { 0: number; 1: number }
      }
   }
   models?: unknown[] // model download manifest — never read
   definitions?: { subgraphs: LiteGraphSubgraphDef[] }
   reroutes?: unknown[] // v1 cosmetic link routing — dropped at normalization
   floatingLinks?: unknown[] // v1 cosmetic — dropped at normalization
   version: 0.4 | 1
}

export const LiteGraphJSON_ark = type({
   'id?': 'string',
   'revision?': 'number',
   'last_node_id?': 'number',
   'last_link_id?': 'number',
   'state?': type.Record('string', 'unknown'),
   nodes: LiteGraphNode_ark.array(),
   links: LiteGraphLink_ark.array(),
   'groups?': LiteGraphGroup_ark.array(),
   'config?': type.Record('never', 'never'),
   'extra?': {
      'ds?': {
         scale: 'number',
         offset: {
            '0': 'number',
            '1': 'number',
         },
      },
   },
   'models?': 'unknown[]',
   'definitions?': { subgraphs: LiteGraphSubgraphDef_ark.array() },
   'reroutes?': 'unknown[]',
   'floatingLinks?': 'unknown[]',
   version: '0.4 | 1',
})

true satisfies IsEqual<LiteGraphJSON, typeof LiteGraphJSON_ark.infer>
