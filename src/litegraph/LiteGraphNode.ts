import { type } from 'arktype'
import type { IsEqual } from 'src/types/index.ts'
import { type LiteGraphNodeInput, LiteGraphNodeInput_ark } from 'src/litegraph/LiteGraphNodeInput.ts'
import { type LiteGraphNodeOutput, LiteGraphNodeOutput_ark } from 'src/litegraph/LiteGraphNodeOutput.ts'

// prettier-ignore
export type LiteGraphNode = {
   id: number // 5
   type: string // 'CLIPTextEncode', or a definitions.subgraphs uuid (instance)

   // cosmetics
   title?: string // "Inpaint (Positive)",
   color?: string // "#222", or  "#3f789e"
   bgcolor?: string // "#3f789e" (lowercase, like upstream)
   pos: { '0': number; '1': number } // serialized as [number, number] OR {0,1}
   size: { '0': number; '1': number }
   flags?: Record<string, unknown> // collapsed?, pinned?, … — never read
   order?: number
   /**
    * 0 = always (normal), 1 = on-event, 2 = muted (never),
    * 3 = on-trigger, 4 = bypassed
    */
   mode?: number
   inputs?: LiteGraphNodeInput[]
   outputs?: LiteGraphNodeOutput[]

   isVirtualNode?: boolean // frontend only
   /** open record: proxyWidgets (subgraph widget promotion), cnr_id/ver (pack provenance), … */
   properties?: Record<string, unknown>
   /** array form (positional) OR object form (named, e.g. VHS_VideoCombine) */
   widgets_values?: unknown[] | Record<string, unknown>
}

export const LiteGraphNode_ark = type({
   id: 'number',
   type: 'string',

   // cosmetics
   'title?': 'string',
   'color?': 'string',
   'bgcolor?': 'string',
   pos: { '0': 'number', '1': 'number' },
   size: { '0': 'number', '1': 'number' },
   'flags?': type.Record('string', 'unknown'),
   'order?': 'number',
   'mode?': 'number',
   'inputs?': LiteGraphNodeInput_ark.array(),
   'outputs?': LiteGraphNodeOutput_ark.array(),
   'isVirtualNode?': 'boolean',
   'properties?': type.Record('string', 'unknown'),
   'widgets_values?': type('unknown[]').or(type.Record('string', 'unknown')),
})

true satisfies IsEqual<LiteGraphNode, typeof LiteGraphNode_ark.infer>
