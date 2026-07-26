import type { Maybe } from 'src/types/index.ts'
import { CodeBuffer } from 'src/utils/CodeBuffer.ts'
import { escapeJSKey } from 'src/utils/escapeJSKey.ts'
import type { ComfyInputOpts, ComfyNodeSchemaJSON } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'
import type { ComfyUnionInfo, NodeInputExt, NodeOutputExt } from 'src/sdk-generator/comfyui-types.ts'
import { ComfyPrimitiveMapping } from 'src/sdk-generator/Primitives.ts'

export type NodeOwnEnum = {
   in: 'input' | 'output'
   ownName: string
   enum: ComfyUnionInfo
}

export class ComfyNodeSchema {
   /** list of types the node has a single output of */
   _singleOutputs: Maybe<NodeOutputExt[]> = null

   get singleOutputs(): NodeOutputExt[] {
      if (this._singleOutputs != null) return this._singleOutputs
      const x: { [key: string]: number } = {}
      for (const i of this.outputs) x[i.typeName] = (x[i.typeName] ?? 0) + 1
      this._singleOutputs = this.outputs.filter((i) => x[i.typeName] === 1)
      return this._singleOutputs
   }

   constructor(
      public raw: ComfyNodeSchemaJSON,
      public nameInComfy: string,
      public nodeKey: string, // same but qualified to keep track of pythonNamespace
      public category: string,
      public inputs: NodeInputExt[],
      public outputs: NodeOutputExt[],
      public pythonModule: string,
   ) {
      this.category = this.category.replaceAll('/', '_')
   }

   codegenUI(): string {
      const b = new CodeBuffer()
      const p = b.w
      p(`   ${escapeJSKey(this.nodeKey)}: {`)
      this.inputs.forEach((i, _ix) => {
         // 1/3
         if (i.isPrimitive) {
            const tsType = ComfyPrimitiveMapping[i.typeName]
            if (tsType == null) return console.log(`[🔶] invariant violation`)
            p(`      ${escapeJSKey(i.nameInComfy)}: { kind: '${tsType}', type: ${tsType} }`)
         }
         // 2/3
         else if (i.isEnum) {
            p(`      ${escapeJSKey(i.nameInComfy)}: { kind: 'enum', type: Union['${i.typeName}'] }`)
            // p(`      ${escapeJSKey(i.nameInComfy)}: { kind: 'enum', type: '${this.nodeKey}.${i.nameInComfy}' }`) // prettier-ignore
         }
         // 3/3
         else {
            p(`      // ${escapeJSKey(i.nameInComfy)}: { kind: 'object', type: ${i.typeName} }`)
         }
      })
      p(`   }`)
      return b.content
   }

   renderOpts(opts?: ComfyInputOpts): Maybe<string> {
      if (opts == null) return null
      if (typeof opts === 'string') return null
      let out = '/**'
      if (opts.default != null) out += ` default=${JSON.stringify(opts.default)}`
      if (opts.min != null) out += ` min=${JSON.stringify(opts.min)}`
      if (opts.max != null) out += ` max=${JSON.stringify(opts.max)}`
      if (opts.step != null) out += ` step=${JSON.stringify(opts.step)}`
      out += ' */'
      return out
   }
}

export const wrapQuote = (s: string): string => {
   if (s.includes("'")) return `"${s}"`
   return `'${s}'`
}
