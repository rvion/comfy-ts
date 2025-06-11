import { type } from 'arktype'
import type { Branded } from '../types'

export const asLiteGraphLinkID = (id: number): LiteGraphLinkID => id as LiteGraphLinkID
export const LiteGraphLinkID_ = type.number.atLeast(0).as<Branded<number, { LiteGraphLinkID: true }>>()
export type LiteGraphLinkID = typeof LiteGraphLinkID_.infer
