import type { ComfyApiJson } from 'src/sdk-generator/comfy-api-json.ts'

/**
 * the `ephemeral: true` rewrite (architecture.md item 14): every SaveImage
 * node in the SENT snapshot becomes a SaveImageWebsocket (core node, `images`
 * input only), so outputs stream over the ws and never touch the server disk.
 * Mutates the given apiJson IN PLACE — callers pass the run's deep-copied
 * snapshot, never the live graph. Returns how many nodes were rewritten so
 * callers can warn when a graph had nothing to rewrite.
 */
export function rewriteSaveNodesToWebsocket(apiJson: ComfyApiJson): number {
   let rewritten = 0
   for (const node of Object.values(apiJson)) {
      if (node.class_type !== 'SaveImage') continue
      const images = node.inputs['images']
      node.class_type = 'SaveImageWebsocket'
      node.inputs = images == null ? {} : { images }
      rewritten++
   }
   return rewritten
}
