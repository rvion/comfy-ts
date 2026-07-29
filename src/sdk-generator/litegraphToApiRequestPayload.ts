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
import { howManyWidgetValuesForThisInputType } from 'src/sdk-generator/Primitives.ts'
import {
   classifySchemaInput,
   classifyWidgetInput,
   defaultValueForWidget,
   isRecord,
   type DynamicComboOption,
   type RawInputSpecEntry,
} from 'src/sdk-generator/inputWidgetKind.ts'

type PromptInputValue = ComfyApiNodeJson['inputs'][string]

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
 * named wins, but a live link wins over both). Widget-ness is decided from
 * the input CONFIG (inputWidgetKind.ts): V3 string-spelled widget types
 * (COMBO options, dynamic combos, autogrow containers, socketless customs)
 * and 2024-era enums go through ONE classifier; a positional array shorter
 * than the schema's widget list fills schema defaults, never throws
 * (agent/architecture.md owns both decisions).
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

      // 2.a widget values, walked in schema order. Widget-ness comes from the
      // input CONFIG (classifySchemaInput — agent/architecture.md): named wins,
      // else positional cursor, else SCHEMA-DEFAULT FILL (what the frontend
      // does when an old file meets a grown schema — a throw would reject files
      // ComfyUI runs fine). The offset advances past named-shadowed slots
      // whenever a positional array exists (promotion case). A LIVE LINK on
      // the field wins over both — the widget value is kept as the fallback
      // for dead-end link resolution (muted/bypassed parents).
      let offset = 0
      const positional = node.widgets.positional
      const named = node.widgets.named
      const widgetFallback = new Map<string, PromptInputValue>()
      const inputsInNodeJSON: CanonicalInput[] = node.inputs
      const inputsInNodeSchema: NodeInputExt[] = nodeSchema.inputs

      /** arrays ride wrapped (a bare 2-list is a link server-side); objects pass only in lax (custom-widget) domains */
      const toPromptValue = (value: unknown, p: { promptName: string; strict: boolean }): PromptInputValue => {
         if (value == null) return null
         if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
         if (Array.isArray(value)) return { __value__: value }
         if (!p.strict && isRecord(value)) return value
         throw new WorkflowConvertError(
            'invalid-widget-value',
            `node ${node.id}(${node.type}) has an invalid widget value for "${p.promptName}": ${JSON.stringify(value)}`,
            node,
         )
      }

      /** named wins, then positional cursor; filled=true when both miss (caller falls back to the schema default) */
      const resolveWidgetValue = (p: { promptName: string; consumes: number }): { value: unknown; filled: boolean } => {
         let value: unknown
         let has = false
         if (Object.hasOwn(named, p.promptName)) {
            value = named[p.promptName]
            has = true
         } else if (offset < positional.length) {
            value = positional[offset]
            has = true
         }
         if (positional.length > 0) offset += p.consumes // named-shadow still advances (promotion case)
         return { value, filled: !has }
      }

      const consumePlainWidget = (p: {
         promptName: string
         typeName: string
         opts: unknown
         consumes: number
         strict: boolean
         enumValues?: readonly (string | boolean | number)[]
         linkedInput: CanonicalInput | undefined
      }): void => {
         const r = resolveWidgetValue({ promptName: p.promptName, consumes: p.consumes })
         const raw = r.filled
            ? defaultValueForWidget({
                 type: p.typeName,
                 opts: p.opts,
                 enumValues: p.enumValues ?? schema.knownUnionByName.get(p.typeName)?.values,
              })
            : r.value
         const value = toPromptValue(raw, { promptName: p.promptName, strict: p.strict })
         if (r.filled) LOG(`${node.type}#${node.id}.${p.promptName} = ${JSON.stringify(value)} (schema-default fill)`)
         if (p.linkedInput?.link != null) widgetFallback.set(p.promptName, value)
         else inputs[p.promptName] = value
      }

      /** key consumed first, then the SELECTED branch inline, recursively (backend get_finalized_class_inputs) */
      const consumeDynamicCombo = (p: { path: string; options: DynamicComboOption[]; defaultKey: string }): void => {
         const r = resolveWidgetValue({ promptName: p.path, consumes: 1 })
         const key = r.filled ? p.defaultKey : r.value
         if (typeof key !== 'string')
            throw new WorkflowConvertError(
               'invalid-widget-value',
               `node ${node.id}(${node.type}): dynamic combo "${p.path}" key is not a string: ${JSON.stringify(key)}`,
               node,
            )
         const opt = p.options.find((o) => o.key === key)
         if (opt == null)
            throw new WorkflowConvertError(
               'invalid-widget-value',
               `node ${node.id}(${node.type}): "${key}" is not an option of dynamic combo "${p.path}" (options: ${p.options.map((o) => o.key).join(', ')})`,
               node,
            )
         if (r.filled) LOG(`${node.type}#${node.id}.${p.path} = ${key} (schema-default fill)`)
         inputs[p.path] = key
         for (const sub of opt.inputs) consumeBranchInput(`${p.path}.${sub.name}`, sub)
      }

      const consumeBranchInput = (subPath: string, sub: RawInputSpecEntry): void => {
         const kind = classifyWidgetInput({ name: sub.name, type: sub.type, opts: sub.opts })
         // slots and containers materialize as dotted serialized inputs, resolved as links in 2.b
         if (kind.kind === 'slot' || kind.kind === 'dynamic-container') return
         if (kind.kind === 'dynamic-combo')
            return consumeDynamicCombo({ path: subPath, options: kind.options, defaultKey: kind.defaultKey })
         const inlineEnum = Array.isArray(sub.type)
            ? sub.type.filter(
                 (v): v is string | number | boolean =>
                    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
              )
            : undefined
         consumePlainWidget({
            promptName: subPath,
            typeName: typeof sub.type === 'string' ? sub.type : 'COMBO',
            opts: sub.opts,
            consumes: kind.consumes,
            strict: kind.strictValues,
            enumValues: inlineEnum,
            linkedInput: inputsInNodeJSON.find((i) => i.name === subPath),
         })
      }

      for (const field of inputsInNodeSchema) {
         const input = inputsInNodeJSON.find((i) => i.name === field.nameInComfy)
         let kind = classifySchemaInput(field)
         // era drift: the file serialized this input widget-backed while the
         // schema now says slot (e.g. forceInput added later) — the file
         // proves a widget value was written, so consume per the file's era
         if (kind.kind === 'slot' && input?.widgetName != null) {
            const legacyConsumes = howManyWidgetValuesForThisInputType(input.type, field.nameInComfy)
            kind = { kind: 'widget', consumes: legacyConsumes === 2 ? 2 : 1, strictValues: true }
         }

         if (kind.kind === 'widget') {
            consumePlainWidget({
               promptName: field.nameInComfy,
               typeName: field.typeName,
               opts: field.opts,
               consumes: kind.consumes,
               strict: kind.strictValues,
               linkedInput: input,
            })
         } else if (kind.kind === 'dynamic-combo') {
            consumeDynamicCombo({ path: field.nameInComfy, options: kind.options, defaultKey: kind.defaultKey })
         } else if (kind.kind === 'dynamic-container') {
            // the declaration itself never appears; the first template.min
            // instances must be connected (backend requires them by name)
            for (const instName of kind.instanceNames.slice(0, kind.requiredCount)) {
               const iname = `${field.nameInComfy}.${instName}`
               const inst = inputsInNodeJSON.find((i) => i.name === iname)
               if (inst?.link == null)
                  throw new WorkflowConvertError(
                     'missing-required-input',
                     `node ${node.id}(${node.type}): autogrow "${field.nameInComfy}" requires instance "${iname}" connected (template.min = ${kind.requiredCount})`,
                     node,
                  )
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
