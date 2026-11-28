// a comma separated input type (`MESH,FILE_3D_GLB,…`, SaveGLB's `mesh`) accepts an output of ANY
// listed type: the frontend links them, the server takes them. The generated `Accepts` must too
import { describe, expect, it } from 'bun:test'
import { slotTypeAccepts } from 'src/graph/ComfyNode.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import type { ComfyNodeSchemaJSON } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'

const node = (p: {
   name: string
   input: NonNullable<ComfyNodeSchemaJSON['input']['required']>
   output: string[]
}): ComfyNodeSchemaJSON => ({
   input: { required: p.input },
   input_order: { required: Object.keys(p.input) },
   output: p.output,
   output_is_list: p.output.map(() => false),
   output_name: p.output,
   name: p.name,
   display_name: p.name,
   description: '',
   python_module: 'comfy_extras.nodes_test',
   category: 'test',
   output_node: p.output.length === 0,
})

const spec = {
   MakeMesh: node({ name: 'MakeMesh', input: { seed: ['INT', {}] }, output: ['MESH'] }),
   MakeSplat: node({ name: 'MakeSplat', input: { seed: ['INT', {}] }, output: ['FILE_3D_SPLAT'] }),
   SaveAny3D: node({ name: 'SaveAny3D', input: { mesh: ['MESH,FILE_3D_SPLAT,FILE_3D_GLB', {}] }, output: [] }),
}

describe('codegen: a comma separated input type', () => {
   const schema = new ComfySchema({ spec, embeddings: [] })
   schema.update({})
   const dts = schema.codegenDTS({ hostId: 'multitype-host' })
   const accepts = dts.slice(dts.indexOf('interface Accepts {'))
   const line = accepts.split('\n').find((l) => l.trimStart().startsWith('"MESH,FILE_3D_SPLAT,FILE_3D_GLB":')) ?? ''

   // why we think it is actually a bug, and not just meaning spec should change: ComfyUI's own SaveGLB declares `mesh` as such a list and its MoGe and DA3 mesh nodes output MESH into it; the typed sdk refused that link, so no typed workflow could save a mesh
   it('accepts each listed type', () => {
      expect(line).toContain(`Accepts['MESH']`)
      expect(line).toContain(`Accepts['FILE_3D_SPLAT']`)
   })

   // control: a part no node outputs still names its own output type, so the line stays valid
   it('a part that no node outputs is its bare output type', () => {
      expect(line).toContain(`ComfyNodeOutput<'FILE_3D_GLB'>`)
   })
})

describe('runtime: a node linked into a comma separated input', () => {
   // why we think it is actually a bug, and not just meaning spec should change: the typed sdk now accepts the MoGe mesh node into SaveGLB, and the graph builder must pick its MESH output; it crashed with a bare TypeError on undefined.outKey instead
   it('picks the output whose type is one of the listed types', () => {
      expect(slotTypeAccepts('MESH,FILE_3D_SPLAT,FILE_3D_GLB', 'MESH')).toBe(true)
      expect(slotTypeAccepts('MESH,FILE_3D_SPLAT,FILE_3D_GLB', 'FILE_3D_SPLAT')).toBe(true)
   })

   // control: a plain type still matches only itself, and a listed type is never a prefix match
   it('a plain type matches itself only', () => {
      expect(slotTypeAccepts('IMAGE', 'IMAGE')).toBe(true)
      expect(slotTypeAccepts('IMAGE', 'MASK')).toBe(false)
      expect(slotTypeAccepts('MESH,FILE_3D_GLB', 'FILE_3D')).toBe(false)
   })
})
