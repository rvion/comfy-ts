import { describe, expect, it } from 'bun:test'
import { type } from 'arktype'
import { ComfySchemaJSON_ark } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'

// verbatim from a ComfyUI 0.37.0 /object_info (v3 nodes send null display_name and null tooltips)
const latentConcat = {
   input: {
      required: {
         samples1: ['LATENT', {}],
         samples2: ['LATENT', {}],
         dim: ['COMBO', { multiselect: false, options: ['x', '-x', 'y', '-y', 't', '-t'] }],
      },
   },
   input_order: { required: ['samples1', 'samples2', 'dim'] },
   is_input_list: false,
   output: ['LATENT'],
   output_is_list: [false],
   output_name: ['LATENT'],
   output_tooltips: [null],
   output_matchtypes: null,
   name: 'LatentConcat',
   display_name: null,
   description: '',
   python_module: 'comfy_extras.nodes_latent',
   category: 'model/latent/advanced',
   output_node: false,
   deprecated: false,
   experimental: false,
}

const control = {
   ...latentConcat,
   name: 'LatentConcatNamed',
   display_name: 'Latent Concat',
   output_tooltips: ['the joined latent'],
}

describe('object_info null fields', () => {
   // why we think it is actually a bug, and not just meaning spec should change: ComfyUI itself sends these nulls for 177 core nodes, so every connect to a current host prints 1313 validation errors about a payload that is valid
   it('a v3 node with null display_name and null tooltips validates', () => {
      const res = ComfySchemaJSON_ark({ LatentConcat: latentConcat })
      expect(res instanceof type.errors ? res.summary : 'ok').toBe('ok')
   })

   // why we think it is actually a bug, and not just meaning spec should change: same host, core nodes; ComfyUI sends null for output_is_list on its deprecated text nodes and object defaults for its curve, trim and crop widgets
   it('a null output_is_list entry and an object widget default validate', () => {
      const res = ComfySchemaJSON_ark({
         TextToLowercase: {
            input: { required: { texts: ['STRING', { tooltip: 'Text to process.', multiline: false }] } },
            output: ['STRING'],
            output_is_list: [null],
            output_name: ['texts'],
            name: 'TextToLowercase',
            display_name: 'Convert Text to Lowercase (DEPRECATED)',
            description: 'Convert text to lowercase.',
            python_module: 'comfy_extras.nodes_dataset',
            category: 'text',
            output_node: false,
         },
         CurveEditor: {
            input: {
               required: {
                  curve: [
                     'CURVE',
                     {
                        default: {
                           points: [
                              [0, 0],
                              [1, 1],
                           ],
                           interpolation: 'monotone_cubic',
                        },
                        socketless: true,
                     },
                  ],
               },
               optional: { histogram: ['HISTOGRAM', {}] },
            },
            output: ['CURVE'],
            output_is_list: [false],
            output_name: ['curve'],
            name: 'CurveEditor',
            display_name: 'Curve Editor',
            description: '',
            python_module: 'comfy_extras.nodes_curve',
            category: 'utilities',
            output_node: false,
         },
      })
      expect(res instanceof type.errors ? res.summary : 'ok').toBe('ok')
   })

   it('control: a node with every string filled validates', () => {
      const res = ComfySchemaJSON_ark({ LatentConcatNamed: control })
      expect(res instanceof type.errors ? res.summary : 'ok').toBe('ok')
   })
})
