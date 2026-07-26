import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ComfyTS } from 'src/state.ts'

// the global registration is process-wide state: isolate each test and restore
// whatever another test file (workflow-builder) may have registered
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
beforeEach(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
})
afterEach(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

describe('idempotent bootstrap (modules may execute multiple times)', () => {
   test('ComfyTS.create() twice returns the SAME instance', () => {
      const a = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-singleton-')) })
      const b = ComfyTS.create()
      expect(b).toBe(a)
   })

   test('new ComfyTS() twice still throws (create() is the multi-module path)', () => {
      new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-singleton-')) })
      expect(() => new ComfyTS()).toThrow('already created')
   })

   test('ComfyTS.create() with a CONFLICTING rootPath throws loud', () => {
      ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-singleton-')) })
      expect(() => ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-other-')) })).toThrow('conflicts')
   })

   test('host() with the same id returns the SAME instance (one ws per host)', () => {
      const comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-singleton-')) })
      const a = comfy.host({ id: 'h1', host: '127.0.0.1', port: 65501 })
      const b = comfy.host({ id: 'h1', host: '127.0.0.1', port: 65501 })
      expect(b).toBe(a)
   })

   test('host() reusing an id with a DIFFERENT address throws loud', () => {
      const comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-singleton-')) })
      comfy.host({ id: 'h1', host: '127.0.0.1', port: 65501 })
      expect(() => comfy.host({ id: 'h1', host: '127.0.0.1', port: 65502 })).toThrow('already registered')
   })
})
