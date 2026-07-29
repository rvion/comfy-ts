import type { ComfyNodeSchemaJSON } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'

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

// schema-driven widget counting moved to src/sdk-generator/inputWidgetKind.ts
// (config-driven classification); what stays below is the LEGACY serialized-
// type path, used only when an old file carries a widget-marked input whose
// schema now says slot.

/**
 * when a litegraph node has an input entry with a widget marker, the
 * serialized TYPE string decides how many widgets_values it consumed in that era
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
