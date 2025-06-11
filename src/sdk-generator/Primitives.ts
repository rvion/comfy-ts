import type { LiteGraphNode } from '../litegraph/LiteGraphNode'
import type { ComfyNodeSchemaJSON } from './ComfyUIObjectInfoTypes'
import type { NodeInputExt } from './comfyui-types'

export const ComfyPrimitiveMapping: { [key: string]: string } = {
   // BACK
   BOOLEAN: 'boolean',
   FLOAT: 'number',
   INT: 'number',
   STRING: 'string',

   // ????
   // ⏸️ Boolean: 'boolean',
   // ⏸️ Float: 'number',
   // ⏸️ Integer: 'number',
   // ⏸️ SchedulerName: 'string',
   // ⏸️ SamplerName: 'string',
   // ⏸️ IMAGE_PATH: 'string',
}

export const ComfyPrimitives: string[] = Object.keys(ComfyPrimitiveMapping)

/**
 * when a litegraph node has no input for a given ComfyUI node input
 * (e.g. a seed or an enum that has not been turned into a primitive)
 */
export const howManyWidgetValuesForThisSchemaType = (input: NodeInputExt): number => {
   if (input.typeName === 'INT') {
      if (input.nameInComfy === 'seed' || input.nameInComfy === 'noise_seed') return 2
   }
   if (input.isPrimitive) return 1
   // 🔴
   if (input.typeName.startsWith('E_')) return 1
   // console.log(343, input)
   return 0
}

/**
 * then a litegraph node has an input entry, some convoluted logic seems to be necessary
 * to determine how many Field_values need to be consumed for this input
 */
export const howManyWidgetValuesForThisInputType = (type: string, nameInComfy: string): number => {
   if (type === 'INT') {
      if (nameInComfy === 'seed' || nameInComfy === 'noise_seed') return 2
      return 1
   }
   if (type === 'BOOLEAN') return 1
   if (type === 'FLOAT') return 1
   if (type === 'STRING') return 1
   if (type === 'COMBO') return 1
   if (type === 'INT:seed') return 2
   if (type === 'INT:noise_seed') return 2

   // not a primitive, no Field_values
   return 0
}
export const ComfyDefaultNodeWhenUnknown_Name: string = 'UnknownNodeXX'

export const ComfyDefaultNodeWhenUnknown_Schema: ComfyNodeSchemaJSON = {
   category: 'test',
   input: {},
   output: [],
   description: 'This is a test node',
   output_name: [],
   display_name: 'UnknownNodeXX',
   name: 'UnknownNodeXX',
   output_is_list: [],
   output_node: false,
   python_module: 'nodes',
}

export class UnknownCustomNode extends Error {
   constructor(public node: LiteGraphNode) {
      super(`❌ node ${node.id}(${node.type}) has no known schema; you probably need to install some custom node`)
   }
}
