import type {
   CanonicalInput,
   CanonicalLink,
   CanonicalNode,
   CanonicalWorkflow,
} from 'src/litegraph/CanonicalWorkflow.ts'
import type { LiteGraphLinkID } from 'src/litegraph/LiteGraphLinkID.ts'
import type { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import type { ComfyNodeSchema } from 'src/sdk-generator/ComfyNodeSchema.ts'
import type { ComfyApiJson, ComfyApiNodeJson } from 'src/sdk-generator/comfy-api-json.ts'
import type { NodeInputExt } from 'src/sdk-generator/comfyui-types.ts'
import {
   howManyWidgetValuesForThisInputType,
   howManyWidgetValuesForThisSchemaType,
} from 'src/sdk-generator/Primitives.ts'

export type WorkflowConvertErrorCode =
   | 'unknown-node'
   | 'missing-widget-value'
   | 'invalid-widget-value'
   | 'dangling-link'
   | 'missing-required-input'
   | 'unsupported-feature'

/** a canonical workflow the converter cannot turn into a prompt — the code NAMES the feature that failed */
export class WorkflowConvertError extends Error {
   constructor(
      public code: WorkflowConvertErrorCode,
      message: string,
      public node?: { id: number; type: string },
   ) {
      super(`[workflow ${code}] ${message}`)
      this.name = 'WorkflowConvertError'
   }
}

/**
 * closed set: frontend-only node types that NEVER execute. PrimitiveString /
 * PrimitiveInt / PrimitiveBoolean etc are REAL backend nodes — do not add them.
 */
const VIRTUAL_NODE_TYPES: ReadonlySet<string> = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode'])

const isNeverExecuted = (node: CanonicalNode): boolean => node.isVirtualNode || VIRTUAL_NODE_TYPES.has(node.type)

/** exact match, or `*` wildcard on either side (Reroute-style slots) */
const linkTypeMatches = (a: string, b: string): boolean => a === b || a === '*' || b === '*'

/**
 * convert a normalized workflow (CanonicalWorkflow — see parseWorkflowJson)
 * into the api.json (prompt format) ComfyUI's POST /prompt takes.
 * Handles: muted nodes (skipped, consumers resolve unconnected), bypassed
 * nodes (mode 4: link resolution walks through to the first type-matching
 * input), Note/MarkdownNote/Reroute/PrimitiveNode virtual nodes (reroutes
 * unwrapped, primitives inlined into their consumers), widget values both
 * positional (with the phantom `control_after_generate` offset after seeds)
 * and named (object-form widgets_values + subgraph promotion overrides —
 * named wins, but a live link wins over both).
 */
export const convertLiteGraphToPrompt = (
   /** the ComfySchema object (to look for references/definitions) */
   schema: ComfySchema,
   /** the normalized litegraph document */
   workflow: CanonicalWorkflow,
   opts: { verbose?: boolean } = {},
): ComfyApiJson => {
   const prompt: ComfyApiJson = {}
   const LOG = opts.verbose ? (...args: unknown[]): void => console.log('[🔥] converter:', ...args) : (): void => {}

   // 1. cache primitive node values so links from PrimitiveNode inline as values.
   // A PrimitiveNode may serialize WITHOUT a value (real corpus case): its
   // consumers then resolve unconnected and fall back to their OWN serialized
   // widget values — the primitive only mirrors the consumer's widget.
   const PRIMITIVE_VALUES: { [nodeId: string]: unknown } = {}
   for (const node of workflow.nodes) {
      if (node.type !== 'PrimitiveNode') continue
      if (node.widgets.positional.length > 0) PRIMITIVE_VALUES[node.id] = node.widgets.positional[0]
      else if (Object.hasOwn(node.widgets.named, 'value')) PRIMITIVE_VALUES[node.id] = node.widgets.named['value']
   }

   // 2. every executable node
   for (const node of workflow.nodes) {
      if (isNeverExecuted(node)) continue // frontend-only nodes (reroutes/primitives unwrapped below)
      if (node.mode !== 'normal') continue // muted skipped, bypassed passthrough'd at link resolution

      const inputs: ComfyApiNodeJson['inputs'] = {}
      const fieldNamesPresent = new Set(node.inputs.map((i) => i.name))
      const nodeSchema_ = schema.nodesByNameInComfy[node.type]
      if (nodeSchema_ == null)
         throw new WorkflowConvertError(
            'unknown-node',
            `node ${node.id}(${node.type}) has no schema on this host; a custom node is missing`,
            node,
         )
      const nodeSchema: ComfyNodeSchema = nodeSchema_

      // 2.a widget values: named wins, else positional walk in schema order.
      // The offset advances past named-shadowed slots whenever a positional
      // array exists (promotion case); pure-named nodes do no offset math at
      // all (object-form UI-only keys are never read: no schema field names them).
      // A LIVE LINK on the field wins over both — the widget value is kept as
      // the fallback for dead-end link resolution (muted/bypassed parents).
      let offset = 0
      const widgetFallback = new Map<string, ValidValue>()
      const inputsInNodeJSON: CanonicalInput[] = node.inputs
      const inputsInNodeSchema: NodeInputExt[] = nodeSchema.inputs
      for (const field of inputsInNodeSchema) {
         const input = inputsInNodeJSON.find((i) => i.name === field.nameInComfy)
         const MUST_CONSUME = input?.type
            ? howManyWidgetValuesForThisInputType(input.type, field.nameInComfy)
            : howManyWidgetValuesForThisSchemaType(field)

         if (MUST_CONSUME > 0) {
            const positional = node.widgets.positional
            const hasNamed = Object.hasOwn(node.widgets.named, field.nameInComfy)
            let hasValue = false
            let _value: unknown
            if (hasNamed) {
               _value = node.widgets.named[field.nameInComfy]
               hasValue = true
            } else if (positional.length > 0) {
               if (positional.length < offset + 1)
                  throw new WorkflowConvertError(
                     'missing-widget-value',
                     `node ${node.id}(${node.type}) has not enough widget values for "${field.nameInComfy}"`,
                     node,
                  )
               _value = positional[offset]
               hasValue = true
            }
            if (positional.length > 0) offset += MUST_CONSUME

            const linked = input?.link != null
            if (!hasValue) {
               if (!linked && field.required)
                  throw new WorkflowConvertError(
                     'missing-widget-value',
                     `node ${node.id}(${node.type}) has neither positional nor named widget value for "${field.nameInComfy}"`,
                     node,
                  )
               continue // link resolves in 2.b, or optional absent
            }
            if (!isValidValue(_value))
               throw new WorkflowConvertError(
                  'invalid-widget-value',
                  `node ${node.id}(${node.type}) has an invalid widget value for "${field.nameInComfy}": ${JSON.stringify(_value)}`,
                  node,
               )
            if (linked) {
               widgetFallback.set(field.nameInComfy, _value)
            } else {
               LOG(`${node.type}#${node.id}.${field.nameInComfy} = ${_value} (widget, consumes ${MUST_CONSUME})`)
               inputs[field.nameInComfy] = _value
            }
         } else if (!fieldNamesPresent.has(field.nameInComfy)) {
            if (field.required)
               throw new WorkflowConvertError(
                  'missing-required-input',
                  `node ${node.id}(${node.type}): required input "${field.nameInComfy}" (${field.typeName}) has neither widget value nor link`,
                  node,
               )
         }
      }

      // 2.b links
      type ParentInfo = { node: CanonicalNode; link: CanonicalLink }
      const getParentNode = (linkId: LiteGraphLinkID): ParentInfo => {
         const link = workflow.links.find((link) => link.id === linkId)
         if (link == null)
            throw new WorkflowConvertError(
               'dangling-link',
               `node ${node.id}(${node.type}) references a non-existing link (id=${linkId})`,
               node,
            )
         const parentNode = workflow.nodes.find((n) => n.id === link.originId)
         if (parentNode == null)
            throw new WorkflowConvertError(
               'dangling-link',
               `link ${linkId} references a non-existent parent node ${link.originId}`,
               node,
            )
         return { node: parentNode, link }
      }

      // walk through follow-through parents: Reroute unwraps, bypassed nodes
      // redirect to their first type-matching input (frontend getInputLink
      // semantics, `*` wildcard on either side); muted parents and dead-end
      // bypasses resolve UNCONNECTED. Visited-set guards link cycles.
      type LinkResolution =
         | { kind: 'link'; nodeId: number; slot: number }
         | { kind: 'primitive'; nodeId: number }
         | { kind: 'unconnected'; reason: string }
      const resolveThroughParents = (startLink: LiteGraphLinkID): LinkResolution => {
         const visited = new Set<number>()
         let linkId = startLink
         while (true) {
            const parent: ParentInfo = getParentNode(linkId)
            if (visited.has(parent.node.id))
               throw new WorkflowConvertError(
                  'dangling-link',
                  `node ${node.id}(${node.type}): link resolution loops through node ${parent.node.id}`,
                  node,
               )
            visited.add(parent.node.id)
            if (parent.node.type === 'Reroute') {
               const rerouteIn = parent.node.inputs[0]?.link
               if (rerouteIn == null) return { kind: 'unconnected', reason: 'reroute chain ends on an empty slot' }
               linkId = rerouteIn
               continue
            }
            if (parent.node.mode === 'muted')
               return { kind: 'unconnected', reason: `parent ${parent.node.id}(${parent.node.type}) is muted` }
            if (parent.node.mode === 'bypassed') {
               const through = parent.node.inputs.find((i) => linkTypeMatches(i.type, parent.link.type))
               if (through?.link == null)
                  return {
                     kind: 'unconnected',
                     reason: `bypassed parent ${parent.node.id}(${parent.node.type}) has no connected ${parent.link.type} input to pass through`,
                  }
               linkId = through.link
               continue
            }
            if (parent.node.type === 'PrimitiveNode') {
               if (!(parent.node.id in PRIMITIVE_VALUES))
                  return { kind: 'unconnected', reason: `PrimitiveNode#${parent.node.id} has no widget value` }
               return { kind: 'primitive', nodeId: parent.node.id }
            }
            return { kind: 'link', nodeId: parent.node.id, slot: parent.link.originSlot }
         }
      }

      for (const ipt of node.inputs) {
         if (ipt.link == null) {
            LOG(`${node.type}#${node.id}.${ipt.name}: empty input slot (widget-backed or optional)`)
            continue
         }
         const resolved = resolveThroughParents(ipt.link)
         if (resolved.kind === 'primitive') {
            // inline primitive nodes as plain values
            inputs[ipt.name] = PRIMITIVE_VALUES[resolved.nodeId] as ComfyApiNodeJson['inputs'][string]
            LOG(`${node.type}#${node.id}.${ipt.name} = ${inputs[ipt.name]} (inlined primitive)`)
            continue
         }
         if (resolved.kind === 'link') {
            LOG(`${node.type}#${node.id}.${ipt.name} = [${resolved.nodeId}, ${resolved.slot}] (link)`)
            inputs[ipt.name] = [String(resolved.nodeId), resolved.slot]
            continue
         }
         // unconnected: the serialized widget value covers it, else loud when required
         if (widgetFallback.has(ipt.name)) {
            inputs[ipt.name] = widgetFallback.get(ipt.name) ?? null
            LOG(`${node.type}#${node.id}.${ipt.name} = ${inputs[ipt.name]} (widget fallback, ${resolved.reason})`)
            continue
         }
         const field = inputsInNodeSchema.find((f) => f.nameInComfy === ipt.name)
         if (field?.required)
            throw new WorkflowConvertError(
               'missing-required-input',
               `node ${node.id}(${node.type}): required input "${ipt.name}" resolves unconnected (${resolved.reason}) and no widget value covers it`,
               node,
            )
         LOG(`${node.type}#${node.id}.${ipt.name}: resolves unconnected (${resolved.reason})`)
      }

      prompt[String(node.id)] = { inputs, class_type: node.type }
   }

   return prompt
}

/** alias cause I keep forgetting about this */
export const convertWorkflowToPrompt = convertLiteGraphToPrompt

type ValidValue = string | number | boolean | [string, number] | null
function isValidValue(value: unknown): value is ValidValue {
   if (value == null) return true // null is valid
   if (typeof value === 'string') return true
   if (typeof value === 'number') return true
   if (typeof value === 'boolean') return true
   if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number')
      return true
   return false
}
