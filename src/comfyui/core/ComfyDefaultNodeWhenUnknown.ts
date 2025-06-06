import type { ComfyNodeSchemaJSON } from '../objectInfo/ComfyUIObjectInfoTypes'

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
