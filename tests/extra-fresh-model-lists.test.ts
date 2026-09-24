// the custom node is python, so its suite is python too: this runs it inside the gate
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'bun:test'

describe('extra/comfyui-fresh-model-lists', () => {
   it('a file added under a folder whose mtime never moves (exFAT) reaches the model list', () => {
      const r = spawnSync('python3', ['-B', '-m', 'unittest', 'test_fresh_model_lists'], {
         cwd: 'extra/comfyui-fresh-model-lists',
         encoding: 'utf8',
      })
      if (r.status !== 0) console.error(r.stdout, r.stderr, r.error)
      expect(r.status).toBe(0)
      expect(r.stderr).toContain('Ran 4 tests')
   })
})
