// why we think it is actually a bug, and not just meaning spec should change: the box's kjnodes EndRecordCUDAMemoryHistory sends a 3 element input spec (type, opts, a description string) on ComfyUI 0.37 and 0.45.5 alike; ComfyUI and its frontend read spec[0] and spec[1] only, so the node is valid and every schema load printing an ark error about it is noise
import { describe, expect, it } from 'bun:test'
import { type } from 'arktype'
import { ComfySchemaJSON_ark } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'

const node = (outputPath: unknown[]) => ({
   EndRecordCUDAMemoryHistory: {
      input: { required: { input: ['*'], output_path: outputPath } },
      output: ['*', 'STRING'],
      output_is_list: [false, false],
      output_name: ['input', 'output_path'],
      name: 'EndRecordCUDAMemoryHistory',
      display_name: 'End Recording CUDAMemory History',
      description: '',
      python_module: 'custom_nodes.comfyui-kjnodes',
      category: 'KJNodes/memory',
      output_node: false,
   },
})

describe('repro: 3 element input spec', () => {
   it('control: the 2 element form validates', () => {
      const res = ComfySchemaJSON_ark(node(['STRING', { default: 'x' }]))
      expect(res instanceof type.errors ? res.summary : 'ok').toBe('ok')
   })
   it('the 3 element form validates', () => {
      const res = ComfySchemaJSON_ark(node(['STRING', { default: 'x' }, 'Base path for saving the file']))
      expect(res instanceof type.errors ? res.summary : 'ok').toBe('ok')
   })
})
