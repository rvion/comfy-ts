import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

// his ask 2026-07-30: `comfy-ts tui` with no arg must include the PACKAGED
// examples, so they must open from a fresh consumer project where
// .comfy-ts/hosts/<id>/ does not exist. Before the fix the examples' top-level
// `await host.loadSchemaFromCache()` threw at IMPORT time (file does not
// exist .../object_info.json) and took the whole TUI down.
describe('bundled examples in a consumer project without a schema cache', () => {
   it('module import degrades to base types with a loud log instead of throwing', () => {
      const consumerCwd = mkdtempSync(join(tmpdir(), 'comfy-ts-consumer-'))
      const example = join(import.meta.dir, '..', 'examples', '01-txt2img.cflow.ts')
      try {
         const res = spawnSync('bun', ['-e', `await import(${JSON.stringify(example)}); console.log('IMPORT_OK')`], {
            cwd: consumerCwd,
            encoding: 'utf8',
         })
         expect(res.stderr).toContain('no schema cache')
         expect(res.stdout).toContain('IMPORT_OK')
         expect(res.status).toBe(0)
      } finally {
         rmSync(consumerCwd, { recursive: true, force: true })
      }
   })
})
