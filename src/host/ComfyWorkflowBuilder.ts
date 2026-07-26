import { ComfyNode } from 'src/graph/ComfyNode.ts'
import type { ComfyNodeMetadata } from 'src/graph/ComfyNodeID.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import type { ComfyApiNodeJson } from 'src/sdk-generator/comfy-api-json.ts'

/**
 * runtime builder: one factory method per node of the live schema, defined
 * dynamically. The typed face is `SdkForHost<ID>['Builder']`, obtained via
 * `workflow.builder` (see ComfyWorkflow). The index signature below is what
 * makes the cast between the two legal.
 */
export interface ComfyWorkflowBuilder {
   [nodeName: string]: unknown
}
export class ComfyWorkflowBuilder {
   constructor(public graph: ComfyWorkflow) {
      const schema = graph.host.schema

      for (const node of schema.nodes) {
         try {
            Object.defineProperty(this, node.nodeKey, {
               value: (inputs: ComfyApiNodeJson['inputs'], meta?: ComfyNodeMetadata) => {
                  const uidString = this.___allocateNodeUID(meta)
                  const nodePayload: ComfyApiNodeJson = {
                     class_type: node.nameInComfy,
                     inputs,
                  }
                  return new ComfyNode(graph, uidString, nodePayload, meta ?? {})
               },
            })
         } catch (e) {
            console.log(e)
            console.error('impossible to create builder for node')
            console.log(`current:`, JSON.stringify(node.nameInComfy), JSON.stringify(node.nodeKey))
            const prev = schema.nodes.find((n) => n.nodeKey === node.nodeKey)
            console.log(`prev`, JSON.stringify(prev?.nameInComfy), JSON.stringify(prev?.nodeKey))
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
