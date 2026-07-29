import type { LiteGraphLinkID } from 'src/litegraph/LiteGraphLinkID.ts'

/**
 * the ONE strict internal shape for imported workflows. ZERO optional fields:
 * semantic absence is `null`, serializer noise gets a default at normalization.
 * Every consumer of an imported workflow JSON (converter, sweeps, TUI) reads
 * this type only — optionality never crosses `normalizeWorkflow`. A new
 * consumer needing a wire field ADDS it here (with a default), it does not
 * reach around the pipeline to the raw document.
 */
export type CanonicalWorkflow = {
   /** subgraph instances with a definition are expanded away by normalization (expandSubgraphs.ts) */
   nodes: CanonicalNode[]
   /** object form only, both wire eras unified */
   links: CanonicalLink[]
   /** [] when the document had none */
   groups: CanonicalGroup[]
}

export type CanonicalLink = {
   id: LiteGraphLinkID
   originId: number
   originSlot: number
   targetId: number
   targetSlot: number
   type: string
}

/**
 * raw 0/1/3 (always / on-event / on-trigger) → 'normal'; 2 → 'muted'; 4 → 'bypassed'.
 * Literal union on purpose: converter switches are total, no magic ints downstream.
 */
export type NodeMode = 'normal' | 'muted' | 'bypassed'

export type CanonicalNode = {
   id: number
   type: string
   title: string | null
   mode: NodeMode
   isVirtualNode: boolean // false when absent
   inputs: CanonicalInput[] // [] when absent
   outputs: CanonicalOutput[] // [] when absent
   widgets: CanonicalWidgetValues
   pos: [number, number] // real tuples (wire has {0,1} objects AND arrays)
   size: [number, number]
   properties: Record<string, unknown> // raw passthrough (proxyWidgets, cnr_id/ver)
}

export type CanonicalInput = {
   name: string
   type: string
   link: LiteGraphLinkID | null // null = unconnected (incl. omitted key)
   widgetName: string | null // widget.name when widget-backed
}

export type CanonicalOutput = {
   name: string
   type: string
   links: LiteGraphLinkID[] // [] for null/absent
}

/**
 * ONE shape for all three widget-value realities: array form (positional),
 * object form (named, e.g. VHS_*), and subgraph promotion overrides (named).
 * Both fields ALWAYS present.
 */
export type CanonicalWidgetValues = {
   positional: unknown[]
   named: Record<string, unknown>
}

export type CanonicalGroup = {
   title: string
   bounding: [number, number, number, number]
   color: string // default '#3f789e' (litegraph default)
   fontSize: number // default 24
}
