import { scope, type } from 'arktype'

export const ComfyUIObjectInfoScope = scope({
   ComfySchemaJSON: { '[string]': 'ComfyNodeSchemaJSON' },
   ComfyNodeSchemaJSON: {
      input: {
         'required?': { '[string]': 'ComfyInputSpec' },
         'optional?': { '[string]': 'ComfyInputSpec' },
         'hidden?': { '[string]': 'ComfyInputHiddenEntry' },
      },
      'input_order?': {
         'required?': 'string[]',
         'optional?': 'string[]',
         'hidden?': 'string[]',
      },
      output: 'ComfyInputType[]',
      output_is_list: 'boolean[]',
      output_name: 'string[]',
      name: 'string',
      display_name: 'string',
      description: 'string',
      /**  */
      python_module: 'string',
      category: 'string',
      output_node: 'boolean',
      'output_tooltips?': 'string[]',
      // Stability Flags
      'deprecated?': 'boolean',
      'experimental?': 'boolean',
   },
   ComfyInputSpecAlt1: ['ComfyInputType', 'ComfyInputOpts'],
   ComfyInputSpecAlt2: ['ComfyInputType'],
   // means it's broken,
   // example: https://cushy.fra1.cdn.digitaloceanspaces.com/rvion/d80fcc5e2db2fe0eea071f6065b1f4a4ad354b2f.jpg
   ComfyInputSpecAlt3: type([type.null]),
   ComfyInputSpec: `ComfyInputSpecAlt1 | ComfyInputSpecAlt2 | ComfyInputSpecAlt3`,

   ComfyInputType: `string | ComfyEnumDef`,

   ComfyInputHiddenEntry_broken1: '"CHOOSE"[][]', // BROKEN STUFF (e.g. found in several 'rgthree' nodes)
   ComfyInputHiddenEntry_broken2: type.Record('string', type.unknown), // BROKEN STUFF (e.g. found in "ttN xyPlot")
   ComfyInputHiddenEntry: 'string | ComfyInputHiddenEntry_broken1 | ComfyInputHiddenEntry_broken2 ',

   ComfyInputOpts_simple: 'string',
   ComfyInputOpts_advanced: {
      // 💬 2025-06-11 rvion: "ComfyInputOpts_advanced" added because of  Segment.input.optional.background : Segment.input.optional.background[1].tooltip must be a string or null (was an object) or Segment.input.optional.background must be exactly length 1 (was 2)
      'tooltip?': 'string | null | ComfyInputOpts_advanced',
      'multiline?': 'boolean | null',

      // 💬 2025-06-11 rvion: "number[]" added because of CreateShapeImageOnPath.input.optional.size_multiplier : CreateShapeImageOnPath.input.optional.size_multiplier[1].default must be a number, a string, boolean or null (was an object) or CreateShapeImageOnPath.input.optional.size_multiplier must be exactly length 1 (was 2)
      'default?': 'boolean | number | string | null | number[]',

      'forceInput?': 'boolean | null',
      'min?': 'number | null',
      'round?': 'boolean | number | null',
      'max?': 'number | null',
      'step?': 'number | null',
      /** Observed on 2024-11-01; 171 occurrences */
      'dynamicPrompts?': 'boolean',

      // 💬 2025-06-11 rvion:  "0" added because of CustomControlNetWeightsFluxFromList.input.optional.autosize : CustomControlNetWeightsFluxFromList.input.optional.autosize[1].padding must be boolean (was 0) or CustomControlNetWeightsFluxFromList.input.optional.autosize must be exactly length 1 (was 2)
      'padding?': 'boolean | 0',
   },
   ComfyInputOpts: 'ComfyInputOpts_simple | ComfyInputOpts_advanced',

   ComfyEnumIllustratedItem: {
      content: 'string',
      'image?': 'string | null',
   },
   ComfyEnumItem: 'string | number | boolean | ComfyEnumIllustratedItem',
   ComfyEnumDef: `ComfyEnumItem[]`,
})

const types = ComfyUIObjectInfoScope.export()

export type ComfySchemaJSON = typeof types.ComfySchemaJSON.infer
export type ComfyNodeSchemaJSON = typeof types.ComfyNodeSchemaJSON.infer
export type ComfyInputSpec = typeof types.ComfyInputSpec.infer
export type ComfyInputType = typeof types.ComfyInputType.infer
export type ComfyEnumDef = typeof types.ComfyEnumDef.infer
export type ComfyInputOpts = typeof types.ComfyInputOpts.infer

export const ComfySchemaJSON_ark = types.ComfySchemaJSON
export const ComfyNodeSchemaJSON_ark = types.ComfyNodeSchemaJSON
export const ComfyInputSpec_ark = types.ComfyInputSpec
export const ComfyInputType_ark = types.ComfyInputType
export const ComfyEnumDef_ark = types.ComfyEnumDef
export const ComfyInputOpts_ark = types.ComfyInputOpts
