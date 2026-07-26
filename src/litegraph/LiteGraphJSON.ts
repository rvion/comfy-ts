import { type } from 'arktype'
import type { EmptyRecord, IsEqual } from 'src/types/index.ts'
import { type LiteGraphGroup, LiteGraphGroup_ark } from 'src/litegraph/LiteGraphGroup.ts'
import { type LiteGraphLink, LiteGraphLink_ark } from 'src/litegraph/LiteGraphLink.ts'
import { type LiteGraphNode, LiteGraphNode_ark } from 'src/litegraph/LiteGraphNode.ts'

/** comfy workflows are simply LiteGraphs workflows */
export type ComfyWorkflowJSON = LiteGraphJSON

/** litegraph workflow are stored... in a very unpractical format */
export type LiteGraphJSON = {
   last_node_id: number
   last_link_id: number
   nodes: LiteGraphNode[]
   links: LiteGraphLink[]
   groups: LiteGraphGroup[]
   config: EmptyRecord
   extra: {
      ds?: {
         scale: number
         offset: { 0: number; 1: number }
      }
   }
   version: 0.4
}

export const LiteGraphJSON_ark = type({
   last_node_id: 'number',
   last_link_id: 'number',
   nodes: LiteGraphNode_ark.array(),
   links: LiteGraphLink_ark.array(),
   groups: LiteGraphGroup_ark.array(),
   config: type.Record('never', 'never'),
   extra: {
      'ds?': {
         scale: 'number',
         offset: {
            '0': 'number',
            '1': 'number',
         },
      },
   },
   version: '0.4',
})

true satisfies IsEqual<LiteGraphJSON, typeof LiteGraphJSON_ark.infer>
