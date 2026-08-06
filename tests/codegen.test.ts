import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { hostIdToNamespace } from 'src/sdk-generator/comfyui-sdk-codegen.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'

describe('hostIdToNamespace', () => {
   it('pascal-cases host ids', () => {
      expect(hostIdToNamespace('windows-1')).toBe('Windows1')
      expect(hostIdToNamespace('my_cloud.instance')).toBe('MyCloudInstance')
      expect(hostIdToNamespace('local')).toBe('Local')
   })
   it('guards digit-leading namespaces', () => {
      expect(hostIdToNamespace('4090-box')).toBe('Host4090Box')
   })
   it('throws on unusable ids', () => {
      expect(() => hostIdToNamespace('---')).toThrow()
   })
})

describe('per-host sdk codegen', () => {
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   const parsed = new ComfySchema({ spec, embeddings: ['emb-a', 'emb-b'] })
   const dts = parsed.codegenDTS({ hostId: 'test-host' })

   it('parses every node of the fixture', () => {
      // +1: the injected UnknownNodeXX default schema
      expect(parsed.nodes.length).toBe(Object.keys(spec).length + 1)
   })

   it('wraps everything in the per-host namespace', () => {
      expect(dts).toContain('namespace Comfy {')
      expect(dts).toContain('namespace TestHost {')
      expect(dts).toContain(`'test-host': TestHost.Sdk`)
   })

   it('emits the full sdk surface', () => {
      for (const section of [
         'interface IN {',
         'interface OUT {',
         'interface Node {',
         'interface Builder {',
         'interface Slots {',
         'interface Accepts {',
         'interface Union {',
         'interface Producer {',
         'interface Sdk {',
      ]) {
         expect(dts).toContain(section)
      }
   })

   it('emits embeddings as a literal union', () => {
      expect(dts).toContain(`type Embeddings = 'emb-a' | 'emb-b'`)
   })

   it('emits builtin nodes unprefixed and importable types from comfy-ts', () => {
      expect(dts).toContain(`KSampler(p: IN["KSampler"]`)
      expect(dts).toContain(`from 'comfy-ts'`)
   })

   it('is deterministic', () => {
      const again = new ComfySchema({ spec, embeddings: ['emb-a', 'emb-b'] }).codegenDTS({
         hostId: 'test-host',
      })
      expect(again).toBe(dts)
   })
})

describe('autogrow containers in codegen', () => {
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info-v3-widgets.json', 'utf-8'))
   const dts = new ComfySchema({ spec, embeddings: [] }).codegenDTS({ hostId: 'test-host-v3' })

   it('emits dotted instance keys instead of the container declaration', () => {
      // template.min = 1 → the first instance is required, the rest optional
      expect(dts).toContain(`"values.a": Accepts["FLOAT,INT,BOOLEAN"]`)
      expect(dts).toContain(`"values.b"?: Accepts["FLOAT,INT,BOOLEAN"]`)
      expect(dts).toContain(`"values.z"?: Accepts["FLOAT,INT,BOOLEAN"]`)
      expect(dts).not.toContain(`values: Accepts["COMFY_AUTOGROW_V3"]`)
      expect(dts).not.toContain(`values?: Accepts["COMFY_AUTOGROW_V3"]`)
   })

   it('registers the template sub-input slot type like any slot', () => {
      expect(dts).toContain(`"FLOAT,INT,BOOLEAN":`)
   })
})

describe('dynamic combos in codegen', () => {
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info-v3-widgets.json', 'utf-8'))
   const dts = new ComfySchema({ spec, embeddings: [] }).codegenDTS({ hostId: 'test-host-v3' })

   it('emits one union member per branch, keyed by the option', () => {
      expect(dts).toContain(`{ resize_type: "scale dimensions";`)
      expect(dts).toContain(`{ resize_type: "scale total pixels";`)
      expect(dts).toContain(`{ resize_type: "match size";`)
      // the key has no schema default and is required → never optional
      expect(dts).not.toContain(`resize_type?:`)
   })

   it('types branch inputs as dotted optional keys, combos as literals', () => {
      expect(dts).toContain(`"resize_type.width"?: Accepts["INT"]`)
      expect(dts).toContain(`"resize_type.megapixels"?: Accepts["FLOAT"]`)
      expect(dts).toContain(`"resize_type.crop"?: "disabled" | "center"`)
      // a branch SLOT input registers into Accepts like any slot
      expect(dts).toContain(`"resize_type.match"?: Accepts["IMAGE,MASK"]`)
      expect(dts).toContain(`"IMAGE,MASK":`)
   })

   it('never leaves the opaque widget type as the input face', () => {
      expect(dts).not.toContain(`resize_type: Accepts["COMFY_DYNAMICCOMBO_V3"]`)
   })
})
