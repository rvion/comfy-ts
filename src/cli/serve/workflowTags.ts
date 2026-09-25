// search tags of a workflow, read from its built graph. PURE, tests/serve-workflow-tags.test.ts.
// the graph is the truth: a file named t2a that grew a video output says video

/** one node of a built graph, reduced to what tagging reads */
export type TagNode = {
   id: string
   classType: string
   outputNode: boolean
   /** the node's output slot types, by index */
   outputTypes: readonly string[]
   /** the inputs linked to another node's output: [producer id, output index] */
   links: readonly (readonly [string, number])[]
}

/** display order: what the workflow makes first, then how it works, then free tags */
const MEDIA_BY_TYPE: Record<string, string> = { IMAGE: 'image', AUDIO: 'audio', VIDEO: 'video', STRING: 'text' }
const MEDIA_ORDER = ['image', 'audio', 'video', 'text']

export function workflowTags(p: {
   nodes: readonly TagNode[]
   varKinds: readonly string[]
   extra?: readonly string[]
}): string[] {
   const byId = new Map(p.nodes.map((n) => [n.id, n]))
   const media = new Set<string>()
   for (const node of p.nodes) {
      if (!node.outputNode) continue
      for (const [producerId, ix] of node.links) {
         const type = byId.get(producerId)?.outputTypes[ix]
         const tag = type == null ? undefined : MEDIA_BY_TYPE[type]
         if (tag != null) media.add(tag)
      }
   }
   const out = MEDIA_ORDER.filter((t) => media.has(t))
   if (p.nodes.some((n) => /textgenerate/i.test(n.classType))) out.push('llm')
   if (p.varKinds.includes('image')) out.push('edit')
   for (const tag of p.extra ?? []) {
      const t = tag.trim().toLowerCase()
      if (t !== '' && !out.includes(t)) out.push(t)
   }
   return out
}
