import { type } from 'arktype'
import type { IsEqual } from '../../types/Misc'
import { type LiteGraphLinkID, LiteGraphLinkID_ } from './LiteGraphLinkID'
import { type LiteGraphSlotIndex, LiteGraphSlotIndex_ } from './LiteGraphSlotIndex'

export type LiteGraphNodeOutput = {
   // ❌9 name: string // 'CONDITIONING'
   name: string
   type: string // 'CONDITIONING'
   links: LiteGraphLinkID[] | null
   shape?: number // '2D'
   slot_index?: LiteGraphSlotIndex
}

export const LiteGraphNodeOutput_ark = type({
   name: 'string',
   type: 'string',
   links: LiteGraphLinkID_.array().or(type.null),
   'shape?': 'number',
   'slot_index?': LiteGraphSlotIndex_,
})

true satisfies IsEqual<LiteGraphNodeOutput, typeof LiteGraphNodeOutput_valibot.infer>
