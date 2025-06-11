import { ComfyNode } from '../livegraph/ComfyNode'
import type { ComfyNodeMetadata } from '../livegraph/ComfyNodeID'
import type { ComfyWorkflow } from '../runner/ComfyWorkflow'
import type { ComfyUIAPIRequest_Node } from '../sdk-generator/comfyui-prompt-api'

export interface ComfyWorkflowBuilder extends Comfy.Builder {}
export class ComfyWorkflowBuilder {
   constructor(public graph: ComfyWorkflow) {
      const schema = graph.host.schema

      for (const node of schema.nodes) {
         try {
            Object.defineProperty(this, node.nameInCushy, {
               value: (inputs: ComfyUIAPIRequest_Node['inputs'], meta?: ComfyNodeMetadata) => {
                  const uidString = this.___allocateNodeUID(meta)
                  const nodePayload: ComfyUIAPIRequest_Node = {
                     class_type: node.nameInComfy,
                     inputs,
                  }
                  return new ComfyNode(graph, uidString, nodePayload, meta ?? {})
               },
            })
         } catch (e) {
            console.log(e)
            console.error('impossible to create builder for node')
            console.log(`current:`, JSON.stringify(node.nameInComfy), JSON.stringify(node.nameInCushy))
            const prev = schema.nodes.find((n) => n.nameInCushy === node.nameInCushy)
            console.log(`prev`, JSON.stringify(prev?.nameInComfy), JSON.stringify(prev?.nameInCushy))
            throw e
         }
      }
   }

   /**
    * helper function to allocate an unique node Id while
    * while respecting user provided metadata id if present.
    */
   private ___allocateNodeUID(meta?: ComfyNodeMetadata): string {
      let uidString: string
      if (meta?.id != null && meta.id !== '') {
         // increment the graph _uiNumber, so if we modify this later
         // we won't reuse the same uid and have broken conflicts
         const uidNumber = parseInt(meta.id, 10)
         if (!Number.isNaN(uidNumber) && uidNumber > this.graph._uidNumber)
            this.graph._uidNumber = Math.round(uidNumber + 1)
         uidString = meta.id
      } else {
         uidString = (this.graph._uidNumber++).toString()
      }
      return uidString
   }
}
