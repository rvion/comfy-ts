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

// the cloud examples are IMPORT-SAFE without an api key (agent/examples.md,
// zoo pattern 2026-07-30: 20 zoo files must never paint 20 red ✗ tree rows on
// a keyless machine — the key is only needed at run time, requireCloudKey()
// fronts standalone runs, TUI runs get the typed 401)
describe('cloud example without COMFY_CLOUD_API_KEY', () => {
   const example = join(import.meta.dir, '..', 'examples', '05-comfy-cloud.cflow.ts')
   const importCmd = `await import(${JSON.stringify(example)}); console.log('IMPORT_OK')`

   it('import succeeds keyless (key is a run-time concern)', () => {
      const consumerCwd = mkdtempSync(join(tmpdir(), 'comfy-ts-consumer-'))
      try {
         const env = { ...process.env }
         delete env.COMFY_CLOUD_API_KEY
         const res = spawnSync('bun', ['-e', importCmd], { cwd: consumerCwd, encoding: 'utf8', env })
         expect(res.stdout).toContain('IMPORT_OK')
         expect(res.status).toBe(0)
      } finally {
         rmSync(consumerCwd, { recursive: true, force: true })
      }
   })

   it('standalone run gate throws a clear message naming the env var', () => {
      const helper = join(import.meta.dir, '..', 'examples', 'comfy-cloud', 'cloudHost.ts')
      const cmd = `const { requireCloudKey } = await import(${JSON.stringify(helper)}); requireCloudKey()`
      const env = { ...process.env }
      delete env.COMFY_CLOUD_API_KEY
      const res = spawnSync('bun', ['-e', cmd], { encoding: 'utf8', env })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain('COMFY_CLOUD_API_KEY')
   })

   it('with a key set, import degrades offline like any bundled example', () => {
      const consumerCwd = mkdtempSync(join(tmpdir(), 'comfy-ts-consumer-'))
      try {
         // never the guarded key shape — presence is all the module checks at import
         const env = { ...process.env, COMFY_CLOUD_API_KEY: 'test-dummy-key' }
         const res = spawnSync('bun', ['-e', importCmd], { cwd: consumerCwd, encoding: 'utf8', env })
         expect(res.stderr).toContain('no schema cache')
         expect(res.stdout).toContain('IMPORT_OK')
         expect(res.status).toBe(0)
      } finally {
         rmSync(consumerCwd, { recursive: true, force: true })
      }
   })
})
