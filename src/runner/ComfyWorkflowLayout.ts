/** biome-ignore-all lint/style/noNonNullAssertion: later */
import type { ComfyNode, ComfyNodeUID } from 'src/graph/ComfyNode.ts'
import { bang } from 'src/utils/bang.ts'
import { type TEdge, toposort } from 'src/utils/toposort.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'

/**
 * compute autolayout
 *
 * 💬 2025-06-11 rvion: I tried various autolayout algorithm, but those massive
 * libraries were pretty bad; ended up writing my own simple algorithm, and I'm
 * happy with it. Feel free to improve it, but I think it works well enough.
 * I will accept PRs for new layout algorithms if they don't have massive dependencies.
 **/
export function comfyWorkflowAutoLayout(
   this: ComfyWorkflow,
   p?: {
      /** @default: 20 */
      node_vsep?: number
      /** @default: 20 */
      node_hsep?: number
      /** @default false */
      forceLeft?: boolean
   },
): ComfyWorkflow {
   const nodeIds = toposort(
      this.nodes.map((n) => n.uid),
      this.nodes.flatMap((n) => n._incomingNodes().map((from) => [from, n.uid] as TEdge)),
   )
   const nodes = nodeIds.map((id) => bang(this.getNode(id), `Node not found: ${id}`))
   const cols: ComfyNode[][] = Array.from({ length: nodeIds.length })

   type NodePlacement = {
      node: ComfyNode
      minCol: number
      maxCol?: number
   }
   const ranges: {
      [nodeId: ComfyNodeUID]: NodePlacement
   } = {}

   // console.log(`[🤠] 1/3 ----------------------------`)
   for (const node of nodes) {
      // must be at least 1 after the closest parent
      const parentCols = node.parents.map((p) => ranges[p.uid]!.minCol)
      const minCol = Math.max(...parentCols, -1) + 1
      const range: NodePlacement = { node: node, minCol: minCol }
      ranges[node.uid] = range
   }

   // console.log(`[🤠] 2/3 ----------------------------`)
   if (!p?.forceLeft === true) {
      for (const node of nodes) {
         const range = ranges[node.uid]!
         for (const p of node.parents) {
            const parentRange = ranges[p.uid]!
            parentRange.maxCol =
               parentRange.maxCol != null
                  ? Math.min(parentRange.maxCol, (range.maxCol ?? range.minCol) - 1)
                  : (range.maxCol ?? range.minCol) - 1
         }
      }
   }

   // console.log(`[🤠] 3/3 ----------------------------`)
   for (const node of nodes) {
      const range = ranges[node.uid]!
      const at = range.maxCol ?? range.minCol
      if (cols[at]) cols[at]!.push(node)
      else cols[at] = [node]
   }

   const HSEP = p?.node_hsep ?? 20
   const VSEP = p?.node_vsep ?? 20
   // cols.reverse()
   let colX = 0
   let maxY = 0
   for (const col of cols) {
      if (col == null) continue
      let colWidth = 0
      let currNodeY = 32
      const nodesSorted = col.toSorted((a, b) => b.height - a.height)
      for (const node of nodesSorted) {
         colWidth = Math.max(colWidth, node.width)
         node.x = colX
         node.y = currNodeY
         currNodeY += node.height + VSEP /* V SEP */
      }
      maxY = Math.max(maxY, currNodeY)
      colX += colWidth + HSEP /* H SEP */
   }

   this.height = maxY
   this.width = colX
   return this
}
