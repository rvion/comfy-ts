import { type } from 'arktype'
import type { Branded } from 'src/types/index.ts'

export const asLiteGraphSlotIndex = (id: number): LiteGraphSlotIndex => id as LiteGraphSlotIndex
export const LiteGraphSlotIndex_ = type.number.atLeast(0).as<Branded<number, { LiteGraphSlotIndex: true }>>()
export type LiteGraphSlotIndex = typeof LiteGraphSlotIndex_.infer
