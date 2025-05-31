import { type } from 'arktype'
import type { Branded } from '../../types'

export const asLiteGraphSlotIndex = (id: number): LiteGraphSlotIndex => id as LiteGraphSlotIndex
export const LiteGraphSlotIndex_ = type.number.atLeast(0).as<Branded<number, { LiteGraphSlotIndex: true }>>()
export type LiteGraphSlotIndex = typeof LiteGraphSlotIndex_.infer

// export type LiteGraphSlotIndex = Branded<number, { LiteGraphSlotIndex: true }>

// export function asLiteGraphSlotIndex(id: number): LiteGraphSlotIndex {
//    return id as LiteGraphSlotIndex
// }

// export const LiteGraphSlotIndex_ark = v.custom<LiteGraphSlotIndex>(
//    (v) => typeof v === 'number' && !isNaN(v) && v >= 0,
//    (v): string => {
//       if (typeof v.received !== 'number')
//          return `LiteGraphSlotIndex is not a number (${JSON.stringify(v.received, null, 3)})` // prettier-ignore
//       if (isNaN(v.received)) return 'LiteGraphSlotIndex is NaN'
//       if (v.received < 0) return 'LiteGraphSlotIndex is negative'
//       return '?'
//    },
// )

// const _: IsEqual<LiteGraphSlotIndex, v.InferInput<typeof LiteGraphSlotIndex_valibot>> = true
