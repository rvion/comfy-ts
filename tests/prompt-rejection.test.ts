// ComfyUI answers a refused prompt with a non-200 and its own reason, and no prompt_id. The
// reply used to be ark-validated first, so the console showed "prompt_id must be a string (was
// missing)" and the sentence naming the node and the value was thrown away.
import { describe, expect, it } from 'bun:test'
import { describePromptRejection } from 'src/runner/describePromptRejection.ts'

/** what a host really sends when a lora name is not in the enum it has cached */
const LORA_NOT_IN_LIST = {
   error: {
      type: 'prompt_outputs_failed_validation',
      message: 'Prompt outputs failed validation',
      details: '',
      extra_info: {},
   },
   node_errors: {
      '12': {
         errors: [
            {
               type: 'value_not_in_list',
               message: 'Value not in list',
               details: "lora_name: 'krea2/only-in-manager.safetensors' not in (list of length 200)",
            },
         ],
      },
   },
}

describe('a refused prompt reports what the host said', () => {
   it('names the node and the value it would not take', () => {
      const said = describePromptRejection(LORA_NOT_IN_LIST)
      expect(said).toContain('node 12')
      expect(said).toContain('only-in-manager.safetensors')
      expect(said).toContain('Value not in list')
   })

   it('keeps the top-level reason, with its details when there are any', () => {
      expect(describePromptRejection({ error: { message: 'boom', details: 'because' } })).toBe('boom (because)')
      expect(describePromptRejection({ error: { message: 'boom', details: '' } })).toBe('boom')
   })

   it('several failing nodes are all listed', () => {
      const said = describePromptRejection({
         node_errors: {
            '3': { errors: [{ message: 'a', details: 'x' }] },
            '9': { errors: [{ message: 'b', details: 'y' }] },
         },
      })
      expect(said).toContain('node 3')
      expect(said).toContain('node 9')
   })

   it('a body of the wrong shape says so instead of throwing', () => {
      for (const junk of [null, undefined, 'text', 42, [], {}, { error: 'not an object' }])
         expect(describePromptRejection(junk)).toBe('no reason given')
   })
})
