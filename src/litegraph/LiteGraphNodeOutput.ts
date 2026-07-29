import { type } from 'arktype'
import type { IsEqual } from 'src/types/index.ts'
import { type LiteGraphLinkID, LiteGraphLinkID_ } from 'src/litegraph/LiteGraphLinkID.ts'
import { type LiteGraphSlotIndex, LiteGraphSlotIndex_ } from 'src/litegraph/LiteGraphSlotIndex.ts'

export type LiteGraphNodeOutput = {
   name: string
   type: string // 'CONDITIONING'
   links?: LiteGraphLinkID[] | null // unconnected outputs may omit the key
   shape?: number // '2D'
   slot_index?: LiteGraphSlotIndex
}

export const LiteGraphNodeOutput_ark = type({
   name: 'string',
   type: 'string',
   'links?': LiteGraphLinkID_.array().or(type.null),
   'shape?': 'number',
   'slot_index?': LiteGraphSlotIndex_,
})

true satisfies IsEqual<LiteGraphNodeOutput, typeof LiteGraphNodeOutput_ark.infer>
