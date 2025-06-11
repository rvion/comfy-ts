import { type } from 'arktype'
import type { IsEqual } from '../types'
import { type LiteGraphLinkID, LiteGraphLinkID_ } from './LiteGraphLinkID'

export type LiteGraphLink = [
   linkId: LiteGraphLinkID, //  9,      - linkId
   fromNodeId: number, //       8,      - fromNodeId
   fromNodeOutputIx: number, // 0,      - fromNodeOutputIx
   toNodeId: number, //         9,      - toNodeId
   toNodeInputIx: number, //    0,      - toNodeInputIx
   linkType: string, //         "IMAGE" - type
]

export const LiteGraphLink_ark = type([
   LiteGraphLinkID_, // 9,      - linkId
   'number', //         8,      - fromNodeId
   'number', //         0,      - fromNodeOutputIx
   'number', //         9,      - toNodeId
   'number', //         0,      - toNodeInputIx
   'string', //         "IMAGE" - linkType
])

true satisfies IsEqual<typeof LiteGraphLink_ark.infer, LiteGraphLink>
