import { type } from 'arktype'
import type { Branded } from '../types'

export const asLiteGraphSlotIndex = (id: number): LiteGraphSlotIndex => id as LiteGraphSlotIndex
export const LiteGraphSlotIndex_ = type.number.atLeast(0).as<Branded<number, { LiteGraphSlotIndex: true }>>()
export type LiteGraphSlotIndex = typeof LiteGraphSlotIndex_.infer
