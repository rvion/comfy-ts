import { type } from 'arktype'
import type { IsEqual } from 'src/types/index.ts'
import { type LiteGraphLinkID, LiteGraphLinkID_ } from 'src/litegraph/LiteGraphLinkID.ts'

export type LiteGraphNodeInput = {
   name: string //                  | 'clip'
   type: string //                  | 'CLIP'
   link?: LiteGraphLinkID | null // | 5 (widget-backed inputs omit the key)
   shape?: number //                | 7
   label?: string //                | 'select'
   widget?: {
      name: string //               | 'select'
      config?: unknown //           | 2022-era serializer only, gone since
   }
}

export const LiteGraphNodeInput_ark = type({
   name: 'string',
   type: 'string',
   'link?': LiteGraphLinkID_.or(type.null),
   'shape?': 'number',
   'label?': 'string',
   'widget?': type({
      name: 'string',
      'config?': 'unknown',
   }),
})

true satisfies IsEqual<LiteGraphNodeInput, typeof LiteGraphNodeInput_ark.infer>
