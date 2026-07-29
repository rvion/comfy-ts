import { type } from 'arktype'
import type { IsEqual } from 'src/types/index.ts'
import { type LiteGraphLinkID, LiteGraphLinkID_ } from 'src/litegraph/LiteGraphLinkID.ts'

/** v0.4 serialization: links are 6-tuples (our EXPORT path emits this form) */
export type LiteGraphLinkTuple = [
   linkId: LiteGraphLinkID, //  9,      - linkId
   fromNodeId: number, //       8,      - fromNodeId
   fromNodeOutputIx: number, // 0,      - fromNodeOutputIx
   toNodeId: number, //         9,      - toNodeId
   toNodeInputIx: number, //    0,      - toNodeInputIx
   linkType: string, //         "IMAGE" - type
]

export const LiteGraphLinkTuple_ark = type([
   LiteGraphLinkID_, // 9,      - linkId
   'number', //         8,      - fromNodeId
   'number', //         0,      - fromNodeOutputIx
   'number', //         9,      - toNodeId
   'number', //         0,      - toNodeInputIx
   'string', //         "IMAGE" - linkType
])

true satisfies IsEqual<typeof LiteGraphLinkTuple_ark.infer, LiteGraphLinkTuple>

/** v1 serialization: links are objects (subgraph definition interiors use this) */
export type LiteGraphLinkObject = {
   id: LiteGraphLinkID
   origin_id: number // -10 = the subgraph's inputNode boundary
   origin_slot: number
   target_id: number // -20 = the subgraph's outputNode boundary
   target_slot: number
   type: string
   parentId?: number // reroute chain parent (cosmetic)
}

export const LiteGraphLinkObject_ark = type({
   id: LiteGraphLinkID_,
   origin_id: 'number',
   origin_slot: 'number',
   target_id: 'number',
   target_slot: 'number',
   type: 'string',
   'parentId?': 'number',
})

true satisfies IsEqual<typeof LiteGraphLinkObject_ark.infer, LiteGraphLinkObject>

export type LiteGraphLink = LiteGraphLinkTuple | LiteGraphLinkObject

export const LiteGraphLink_ark = LiteGraphLinkTuple_ark.or(LiteGraphLinkObject_ark)

true satisfies IsEqual<typeof LiteGraphLink_ark.infer, LiteGraphLink>
