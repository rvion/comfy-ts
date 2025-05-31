import { type } from 'arktype'
import type { IsEqual } from '../../types'
import { type LiteGraphLinkID, LiteGraphLinkID_ } from './LiteGraphLinkID'

export type LiteGraphNodeInput = {
   name: string //                 | 'clip'
   type: string //                 | 'CLIP'
   link: LiteGraphLinkID | null // | 5
   shape?: number //               | '2D'
   widget?: {
      name: string //              | 'select'
      config: unknown //           | 🔴
   }
}

export const LiteGraphNodeInput_ark = type({
   name: 'string',
   type: 'string',
   link: LiteGraphLinkID_.or(type.null),
   'shape?': 'number',
   'widget?': type({
      name: 'string',
      config: type.unknown,
   }),
})

true satisfies IsEqual<LiteGraphNodeInput, typeof LiteGraphNodeInput_ark.infer>
