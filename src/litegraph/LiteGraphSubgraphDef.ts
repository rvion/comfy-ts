import { type } from 'arktype'
import type { EmptyRecord, IsEqual } from 'src/types/index.ts'
import { type LiteGraphGroup, LiteGraphGroup_ark } from 'src/litegraph/LiteGraphGroup.ts'
import { type LiteGraphLinkID, LiteGraphLinkID_ } from 'src/litegraph/LiteGraphLinkID.ts'
import { type LiteGraphLinkObject, LiteGraphLinkObject_ark } from 'src/litegraph/LiteGraphLink.ts'
import { type LiteGraphNode, LiteGraphNode_ark } from 'src/litegraph/LiteGraphNode.ts'

/** one exposed input/output slot of a subgraph definition */
export type LiteGraphSubgraphIO = {
   id: string // uuid
   name: string // 'image'
   type: string // 'IMAGE'
   linkIds?: LiteGraphLinkID[]
   label?: string
   localized_name?: string
   pos?: { '0': number; '1': number }
   shape?: number
}

export const LiteGraphSubgraphIO_ark = type({
   id: 'string',
   name: 'string',
   type: 'string',
   'linkIds?': LiteGraphLinkID_.array(),
   'label?': 'string',
   'localized_name?': 'string',
   'pos?': { '0': 'number', '1': 'number' },
   'shape?': 'number',
})

true satisfies IsEqual<LiteGraphSubgraphIO, typeof LiteGraphSubgraphIO_ark.infer>

/**
 * a subgraph definition body (definitions.subgraphs[] entry). Corpus fact:
 * every one is a v1-shaped interior (object links, `state`) even when the
 * root document is v0.4 — instances reference it via node.type = this uuid.
 */
export type LiteGraphSubgraphDef = {
   id: string // uuid, referenced by instance nodes' `type`
   name: string
   version: number // 1 in the whole corpus
   state?: Record<string, unknown> // {lastNodeId, lastLinkId, …} — recomputable
   revision?: number
   config?: EmptyRecord
   extra?: unknown
   nodes: LiteGraphNode[]
   links: LiteGraphLinkObject[]
   groups?: LiteGraphGroup[]
   inputNode: { id: number; bounding: number[] } // id is -10 in boundary links
   outputNode: { id: number; bounding: number[] } // id is -20 in boundary links
   inputs: LiteGraphSubgraphIO[]
   outputs: LiteGraphSubgraphIO[]
   widgets: unknown[] // empty in the whole corpus
}

export const LiteGraphSubgraphDef_ark = type({
   id: 'string',
   name: 'string',
   version: 'number',
   'state?': type.Record('string', 'unknown'),
   'revision?': 'number',
   'config?': type.Record('string', 'unknown').as<EmptyRecord>(),
   'extra?': 'unknown',
   nodes: LiteGraphNode_ark.array(),
   links: LiteGraphLinkObject_ark.array(),
   'groups?': LiteGraphGroup_ark.array(),
   inputNode: { id: 'number', bounding: 'number[]' },
   outputNode: { id: 'number', bounding: 'number[]' },
   inputs: LiteGraphSubgraphIO_ark.array(),
   outputs: LiteGraphSubgraphIO_ark.array(),
   widgets: 'unknown[]',
})

true satisfies IsEqual<LiteGraphSubgraphDef, typeof LiteGraphSubgraphDef_ark.infer>
