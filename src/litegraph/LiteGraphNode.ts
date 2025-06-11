import { type } from 'arktype'
import type { EmptyRecord, IsEqual } from '../types'
import { type LiteGraphNodeInput, LiteGraphNodeInput_ark } from './LiteGraphNodeInput'
import { type LiteGraphNodeOutput, LiteGraphNodeOutput_ark } from './LiteGraphNodeOutput'

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
   widgets_values?: unknown[]
}

export const LiteGraphNode_ark = type({
   id: 'number',
   type: 'string',

   // cospetics
   'title?': 'string',
   'color?': 'string',
   'bgcolor?': 'string',
   pos: { '0': 'number', '1': 'number' },
   size: { '0': 'number', '1': 'number' },
   'flags?': { '[never]': 'never' },
   'order?': 'number',
   'mode?': 'number',
   'inputs?': LiteGraphNodeInput_ark.array(),
   outputs: LiteGraphNodeOutput_ark.array(),
   'isVirtualNode?': 'boolean',
   'properties?': {
      'Node name for S&R?': 'string',
      'showOutputText?': 'boolean',
      'horizontal?': 'boolean',
   },
   'widgets_values?': `unknown[]`,
})

true satisfies IsEqual<LiteGraphNode, typeof LiteGraphNode_ark.infer>
