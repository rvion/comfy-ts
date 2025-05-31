import { type } from 'arktype'
import * as v from 'valibot'
import type { EmptyRecord, IsEqual } from '../../types'
import { type LiteGraphNodeInput, LiteGraphNodeInput_ark } from './LiteGraphNodeInput'
import type { LiteGraphNodeOutput } from './LiteGraphNodeOutput'

// prettier-ignore
export type LiteGraphNode = {
   id: number // 5
   type: string // 'CLIPTextEncode'

   // cosmetics
   title?: string // "Inpaint (Positive)",
   color?: string // "#222", or  "#3f789e"
   bgColor?: string // "#3f789e"
   pos: { '0': number; '1': number } // was: [number, number]
   size: { '0': number; '1': number }
   flags?: EmptyRecord
   order?: number
   /**
    * 0 = normal
    * 1 = ?????
    * 2 = muted
    * */
   mode?: number
   inputs?: LiteGraphNodeInput[]
   outputs: LiteGraphNodeOutput[]

   isVirtualNode?: boolean // frontend only
   properties?: {
      /**
       * S&R stands for search and replace
       * // 💬 2024-11-13 rvion: do we want to populate taht someday soon
       */
      'Node name for S&R'?: string

      /** when set to true, it.... */
      showOutputText?: boolean

      /** no clue what it does */
      horizontal?: boolean
   }
   widgets_values?: any[]
}

export const LiteGraphNode_ark = type({
   id: 'number',
   'title?': 'string',
   'color?': 'string',
   'bgcolor?': 'string',
   type: 'string',
   pos: { 0: 'number', 1: 'number' },
   size: { 0: 'number', 1: 'number' },
   'flags?': {} as EmptyRecord, //v.strictObject({}),
   'order?': 'number',
   'mode?': 'number',
   'inputs?': LiteGraphNodeInput_ark.array(),
   outputs: v.array(LiteGraphNodeOutput_valibot),
   isVirtualNode: v.optional(v.boolean()),
   properties: v.optional(
      v.strictObject({
         horizontal: v.optional(v.boolean()),
         'Node name for S&R': v.optional(v.string()),
         showOutputText: v.optional(v.boolean()),
      }),
   ),
   widgets_values: v.optional(v.array(v.any())),
})

true satisfies IsEqual<LiteGraphNode, v.InferInput<typeof LiteGraphNode_ark>>
