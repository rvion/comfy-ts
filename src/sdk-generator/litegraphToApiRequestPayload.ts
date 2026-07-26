import type { LiteGraphJSON } from 'src/litegraph/LiteGraphJSON.ts'
import type { LiteGraphLink } from 'src/litegraph/LiteGraphLink.ts'
import type { LiteGraphLinkID } from 'src/litegraph/LiteGraphLinkID.ts'
import type { LiteGraphNode } from 'src/litegraph/LiteGraphNode.ts'
import type { LiteGraphNodeInput } from 'src/litegraph/LiteGraphNodeInput.ts'
import type { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import type { ComfyNodeSchema } from 'src/sdk-generator/ComfyNodeSchema.ts'
import type { ComfyApiJson, ComfyApiNodeJson } from 'src/sdk-generator/comfy-api-json.ts'
import type { NodeInputExt } from 'src/sdk-generator/comfyui-types.ts'
import {
   howManyWidgetValuesForThisInputType,
   howManyWidgetValuesForThisSchemaType,
   UnknownCustomNode,
} from 'src/sdk-generator/Primitives.ts'
import type { Maybe } from 'src/types/index.ts'

/**
 * convert a saved ComfyUI workflow.json (litegraph format) into the api.json
 * (prompt format) ComfyUI's POST /prompt takes.
 * Handles: muted nodes, Note/Reroute/PrimitiveNode virtual nodes (reroutes
 * unwrapped, primitives inlined into their consumers), widget-value offsets
 * (incl. the phantom `control_after_generate` value after seeds).
 */
export const convertLiteGraphToPrompt = (
   /** the ComfySchema object (to look for references/definitions) */
   schema: ComfySchema,
   /** the litegraph */
   workflow: LiteGraphJSON,
   opts: { verbose?: boolean } = {},
): ComfyApiJson => {
   const prompt: ComfyApiJson = {}
   const LOG = opts.verbose ? (...args: unknown[]): void => console.log('[🔥] converter:', ...args) : (): void => {}

   // 1. cache primitive node values so links from PrimitiveNode inline as values
   const PRIMITIVE_VALUES: { [nodeId: string]: unknown } = {}
   for (const node of workflow.nodes) {
      if (node.type === 'PrimitiveNode') {
         const widgetValues = node.widgets_values
         if (widgetValues == null || widgetValues.length === 0) {
            throw new Error(`PrimitiveNode#${node.id} has no widget values`)
         }
         PRIMITIVE_VALUES[node.id] = widgetValues[0]
      }
   }

   // 2. every executable node
   for (const node of workflow.nodes) {
      if (node.isVirtualNode) continue // frontend-only nodes
      if (node.mode === 2) continue // muted
      if (node.type === 'Reroute') continue // unwrapped below
      if (node.type === 'Note') continue // comments
      if (node.type === 'PrimitiveNode') continue // inlined into consumers

      const inputs: ComfyApiNodeJson['inputs'] = {}
      const fieldNamesWithLinks = new Set((node.inputs ?? []).map((i) => i.name))
      const nodeSchema_ = schema.nodesByNameInComfy[node.type]
      if (nodeSchema_ == null) throw new UnknownCustomNode(node)
      const nodeSchema: ComfyNodeSchema = nodeSchema_

      // 2.a widget values, consumed in schema order
      let offset = 0
      const inputsInNodeJSON: LiteGraphNodeInput[] = node.inputs ?? []
      const inputsInNodeSchema: NodeInputExt[] = nodeSchema.inputs
      for (const field of inputsInNodeSchema) {
         const input = inputsInNodeJSON.find((i) => i.name === field.nameInComfy)
         const MUST_CONSUME = input?.type
            ? howManyWidgetValuesForThisInputType(input.type, field.nameInComfy)
            : howManyWidgetValuesForThisSchemaType(field)

         if (MUST_CONSUME > 0) {
            if (node.widgets_values == null)
               throw new Error(
                  `node ${node.id}(${node.type}) has no widgets_values but "${field.nameInComfy}" needs one`,
               )
            if (node.widgets_values.length < offset + 1)
               throw new Error(`node ${node.id}(${node.type}) has not enough widgets_values for "${field.nameInComfy}"`)
            const _value = node.widgets_values[offset]
            LOG(`${node.type}#${node.id}.${field.nameInComfy} = ${_value} (widget, consumes ${MUST_CONSUME})`)
            if (!isValidValue(_value))
               throw new Error(
                  `node ${node.id}(${node.type}) has an invalid widget value for "${field.nameInComfy}": ${JSON.stringify(_value)}`,
               )
            inputs[field.nameInComfy] = _value
            offset += MUST_CONSUME
         } else if (!fieldNamesWithLinks.has(field.nameInComfy)) {
            if (field.required)
               throw new Error(
                  `node ${node.id}(${node.type}): required input "${field.nameInComfy}" (${field.typeName}) has neither widget value nor link`,
               )
         }
      }

      // 2.b links
      type ParentInfo = { node: LiteGraphNode; link: LiteGraphLink }
      const getParentNode = (linkId: LiteGraphLinkID): ParentInfo => {
         const link = workflow.links.find((link) => link[0] === linkId)
         if (link == null)
            throw new Error(`Node ${node.id}(${node.type}) references a non-existing link (id=${linkId})`)
         const parentId = link[1]
         const parentNode = workflow.nodes.find((n) => n.id === parentId)
         if (parentNode == null) throw new Error(`link ${linkId} references a non-existent parent node ${parentId}`)
         return { node: parentNode, link }
      }

      INPT: for (const ipt of node.inputs ?? []) {
         const isPrimitive = howManyWidgetValuesForThisInputType(ipt.type, ipt.name) > 0
         if (isPrimitive) continue

         // not a primitive => we assume it's a link
         if (ipt.link == null) {
            LOG(`${node.type}#${node.id}.${ipt.name}: empty input slot (fine when optional)`)
            continue
         }
         let parent: Maybe<ParentInfo> = getParentNode(ipt.link)

         // unwrap reroute chains
         let max = 100
         while (parent != null && parent.node.type === 'Reroute' && max-- > 0) {
            const firstParentInput = parent.node.inputs?.[0]
            if (firstParentInput?.link == null) {
               LOG(`${node.type}#${node.id}.${ipt.name}: reroute chain ends on an empty slot`)
               continue INPT
            }
            parent = getParentNode(firstParentInput.link)
         }
         if (parent == null) throw new Error(`no parent found for ${node.id}.${ipt.name}`)

         // inline primitive nodes as plain values
         if (parent.node.type === 'PrimitiveNode') {
            inputs[ipt.name] = PRIMITIVE_VALUES[parent.node.id] as ComfyApiNodeJson['inputs'][string]
            LOG(`${node.type}#${node.id}.${ipt.name} = ${inputs[ipt.name]} (inlined primitive)`)
            continue
         }

         LOG(`${node.type}#${node.id}.${ipt.name} = [${parent.node.id}, ${parent.link[2]}] (link)`)
         inputs[ipt.name] = [String(parent.node.id), parent.link[2]]
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
