import crypto from 'node:crypto'
import { getUnionNameBasedOnFirstFoundEnumName } from 'src/sdk-generator/_getUnionNameBasedOnFirstFoundEnumName.ts'
import { toQualifiedNodeKey } from 'src/sdk-generator/_toQualifiedNodeKey.ts'
import { ComfyNodeSchema } from 'src/sdk-generator/ComfyNodeSchema.ts'
import type { ComfyEnumDef, ComfyNodeSchemaJSON, ComfySchemaJSON } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'
import { codegenSDK } from 'src/sdk-generator/comfyui-sdk-codegen.ts'
import {
   asComfyNodeSlotName,
   asComfyNodeSlotTypeName,
   type ComfyImageName,
   type ComfyNodeSlotName,
   type ComfyNodeSlotTypeName,
   type ComfyPythonModule,
   type ComfyUnionHash,
   type ComfyUnionInfo,
   type ComfyUnionName,
   type ComfyUnionValue,
   type EmbeddingName,
   type NodeInputExt,
   type NodeNameInComfy,
   type NodeOutputExt,
   type QualifiedNodeKey,
} from 'src/sdk-generator/comfyui-types.ts'
import {
   ComfyDefaultNodeWhenUnknown_Name,
   ComfyDefaultNodeWhenUnknown_Schema,
   ComfyPrimitiveMapping,
   ComfyPrimitives,
} from 'src/sdk-generator/Primitives.ts'
import type { Maybe } from 'src/types/index.ts'
import { escapeJSKey } from 'src/utils/escapeJSKey.ts'
import { logInfo } from 'src/utils/log.ts'

export type ComfySchemaId = string

export type ComfySchemaData = {
   spec: ComfySchemaJSON
   embeddings: string[]
}

/**
 * ONE host's schema: the parsed view of its object_info.json + embeddings.
 * Owns union dedup (by sha1 of values), node indexing, and the per-host
 * sdk codegen (`codegenDTS`).
 */
export class ComfySchema {
   codegenDTS = codegenSDK.bind(this)

   constructor(public data: ComfySchemaData) {
      this.parse()
   }

   update(data: Partial<ComfySchemaData>): void {
      const prev: ComfySchemaData = { spec: this.data.spec, embeddings: this.data.embeddings }
      Object.assign(this.data, data)
      try {
         this.parse()
         this.isInvalid = false
      } catch (error) {
         console.error(`❌ [ComfySchema.update] bad schema — keeping the previous one`, error)
         // roll back: a failed update must not leave half-built indexes in use
         this.data = prev
         try {
            this.parse()
         } catch {
            // previous data unparsable too (first update): indexes stay empty
         }
         this.isInvalid = true
      }
   }

   isInvalid: boolean = false

   /** number of nodes in the current schema (quick way to check your instance infos) */
   get size(): number {
      return Object.keys(this.data.spec).length
   }

   // #region parsed indexes
   knownSlotTypes = new Set<ComfyNodeSlotTypeName>()
   knownUnionBySlotName = new Map<ComfyNodeSlotName, ComfyUnionInfo>()
   knownUnionByHash = new Map<ComfyUnionHash, ComfyUnionInfo>()
   knownUnionByName = new Map<ComfyUnionName, ComfyUnionInfo>()
   nodes: ComfyNodeSchema[] = []
   pythonModuleByNodeKey: Map<QualifiedNodeKey, ComfyPythonModule> = new Map()
   pythonModuleByNodeNameInComfy: Map<NodeNameInComfy, ComfyPythonModule> = new Map()
   nodesByNameInComfy: { [key: NodeNameInComfy]: ComfyNodeSchema } = {}
   nodesByKey: { [key: QualifiedNodeKey]: ComfyNodeSchema } = {}
   nodesByProduction: { [key in ComfyNodeSlotTypeName]?: ComfyNodeSchema[] } = {}

   // some nodes output anonymous unions. we need to keep track of them for codegen
   enumsAppearingInOutput = new Set<ComfyNodeSlotTypeName>()

   pythonModules = new Map<string, NodeNameInComfy[]>()

   // #region parse
   private parse(): void {
      // reset all indexes: parse() re-runs on every update()
      this.knownSlotTypes.clear()
      this.knownUnionBySlotName.clear()
      this.knownUnionByHash.clear()
      this.knownUnionByName.clear()
      this.nodes = []
      this.pythonModuleByNodeKey.clear()
      this.pythonModuleByNodeNameInComfy.clear()
      this.nodesByNameInComfy = {}
      this.nodesByKey = {}
      this.nodesByProduction = {}
      this.enumsAppearingInOutput.clear()
      this.pythonModules.clear()

      // skip log for the initial dummy empty data
      if (this.data.embeddings.length > 0 || Object.keys(this.data.spec).length > 0)
         this.log(`parsing ComfyUI object_info.json`)

      const entries: [string, ComfyNodeSchemaJSON][] = Object.entries(this.data.spec)
      entries.push([ComfyDefaultNodeWhenUnknown_Name, ComfyDefaultNodeWhenUnknown_Schema])

      for (const [KK, VV] of entries) {
         // record python module
         const pythonModule = VV.python_module
         const prev = this.pythonModules.get(pythonModule)
         if (prev == null) this.pythonModules.set(pythonModule, [KK])
         else prev.push(KK)

         const nodeNameInComfy = KK
         const nodeDef = VV
         const nodeKey = toQualifiedNodeKey(pythonModule, nodeNameInComfy)

         if (typeof nodeDef.output === 'string') {
            console.log(
               `[❌ ERROR] nodeDef ${nodeDef.name} has an invalid output definition: ${JSON.stringify(nodeDef.output)}`,
            )
            nodeDef.output = []
         }
         this.pythonModuleByNodeKey.set(nodeKey, pythonModule)
         this.pythonModuleByNodeNameInComfy.set(nodeNameInComfy, pythonModule)

         const inputs: NodeInputExt[] = []
         const outputs: NodeOutputExt[] = []
         const node = new ComfyNodeSchema(VV, nodeNameInComfy, nodeKey, nodeDef.category, inputs, outputs, pythonModule)

         // INDEX NODE
         this.nodesByNameInComfy[nodeNameInComfy] = node
         this.nodesByKey[nodeKey] = node
         this.nodes.push(node)

         // #region outputs ----------------------------------------------------------------------
         const nameCountDict: { [key: string]: number } = {}
         for (const [ix, slotType] of nodeDef.output.entries()) {
            const rawOutputSlotName =
               nodeDef.output_name[ix] || //
               (typeof slotType === 'string' ? slotType : `input_${ix}`)

            const outputNameInComfy = rawOutputSlotName
            const at = (nameCountDict[outputNameInComfy] ??= 0)
            const outKeyValue = at === 0 ? outputNameInComfy : `${outputNameInComfy}_${at}`
            nameCountDict[outputNameInComfy]++

            let slotTypeName: ComfyNodeSlotTypeName
            const outputSlotName = asComfyNodeSlotName(`${node.nodeKey}.${outKeyValue}.OUT`)

            // 1. Primitive
            if (typeof slotType === 'string') {
               slotTypeName = asComfyNodeSlotTypeName(slotType)
               this.knownSlotTypes.add(slotTypeName)
            }
            // 2. ENUM
            else if (Array.isArray(slotType)) {
               const RESX = this.processSlot({ pythonModule, slotName: outputSlotName, comfyUnionDef: slotType })
               slotTypeName = asComfyNodeSlotTypeName(RESX.unionName)
               this.enumsAppearingInOutput.add(slotTypeName)
            }
            // 3. ????
            else {
               throw new Error(`invalid output ${ix} "${slotType}" in node "${nodeNameInComfy}"`)
            }

            // index production
            const arr = this.nodesByProduction[slotTypeName]
            if (arr == null) this.nodesByProduction[slotTypeName] = [node]
            else arr.push(node)

            outputs.push({
               slotName: outputSlotName,
               typeName: slotTypeName,
               nameInComfy: outputNameInComfy,
               outKey: outKeyValue,
               isPrimitive: false,
            })
         }

         // #region inputs ----------------------------------------------------------------------
         const optionalInputs = Object.entries(nodeDef.input?.optional ?? {}) //
            .map(([name, spec]) => ({ required: false, name, spec }))

         const requiredInputs = Object.entries(nodeDef.input?.required ?? {}) //
            .map(([name, spec]) => ({ required: true, name, spec }))
            // when an input is BOTH required and optional (seen in the wild), keep the optional one
            .filter((i) => optionalInputs.find((oi) => oi.name === i.name) == null)
         const allInputs = [...requiredInputs, ...optionalInputs]

         for (const ipt of allInputs) {
            const inputNameInComfy = ipt.name
            const typeDef = ipt.spec
            const slotType = typeDef[0]
            const slotOpts = typeDef[1]

            let inputTypeName: ComfyNodeSlotTypeName
            const inputSlotName = asComfyNodeSlotName(`${node.nodeKey}.${inputNameInComfy}`)

            // 1/4 broken input (null type)
            if (slotType == null) {
               const RESX = this.processSlot({ pythonModule, slotName: inputSlotName, comfyUnionDef: ['❌'] })
               inputTypeName = asComfyNodeSlotTypeName(RESX.unionName)
            }
            // 2/4 named slot type
            else if (typeof slotType === 'string') {
               inputTypeName = asComfyNodeSlotTypeName(slotType)
               this.knownSlotTypes.add(inputTypeName)
            }
            // 3/4 inline enum
            else if (Array.isArray(slotType)) {
               const RESX = this.processSlot({ pythonModule, slotName: inputSlotName, comfyUnionDef: slotType })
               inputTypeName = asComfyNodeSlotTypeName(RESX.unionName)
            }
            // 4/4
            else {
               throw new Error(
                  `invalid schema (${JSON.stringify(slotType)}) for input "${
                     ipt.name
                  }" in node "${nodeNameInComfy}" (type: ${typeof slotType}; expected: Array | string)`,
               )
            }

            node.inputs.push({
               slotName: inputSlotName,
               required: ipt.required,
               nameInComfy: inputNameInComfy,
               nameInComfyEscaped: escapeJSKey(inputNameInComfy),
               typeName: inputTypeName,
               opts: slotOpts,
               isPrimitive: ComfyPrimitives.includes(inputTypeName),
               isEnum: this.knownUnionByName.has(inputTypeName),
               index: node.inputs.length,
            })
         }
      }
   }

   // #region processSlot
   processSlot = (p: {
      pythonModule: string
      slotName: ComfyNodeSlotName
      comfyUnionDef: ComfyEnumDef
   }): ComfyUnionInfo => {
      // 1. build enum
      const enumValues: ComfyUnionValue[] = []
      for (const enumValue of p.comfyUnionDef) {
         if (typeof enumValue === 'string') enumValues.push(enumValue)
         else if (typeof enumValue === 'boolean') enumValues.push(enumValue)
         else if (typeof enumValue === 'number') enumValues.push(enumValue)
         else enumValues.push(enumValue.content)
      }
      // 2. hash its value
      const hashContent =
         enumValues.length === 0 //
            ? `[[empty]]`
            : enumValues.sort().join('|')
      const hash = crypto.createHash('sha1').update(hashContent).digest('hex').slice(0, 8)

      // 3. retrieve or create an EnumInfo
      let unionInfo: Maybe<ComfyUnionInfo> = this.knownUnionByHash.get(hash)
      if (unionInfo == null) {
         const unionName = getUnionNameBasedOnFirstFoundEnumName(p.slotName, hash, hashContent)
         unionInfo = { hash, unionName, values: enumValues, enumNames: [] }
         this.knownUnionByHash.set(hash, unionInfo)
         this.knownUnionByName.set(unionName, unionInfo)
      }
      unionInfo.enumNames.push(p.slotName)

      // 4. store enum by name
      this.knownUnionBySlotName.set(p.slotName, unionInfo)
      return unionInfo
   }

   private log(...args: unknown[]): void {
      logInfo(`[👅]: ${args.join(' ')}`)
   }

   toTSType(t: string): string {
      // '*' is ComfyUI's wildcard: any output or primitive fits
      if (t === '*') return `string | number | boolean | ComfyNodeOutput<string, number>`
      return ComfyPrimitiveMapping[t]
         ? `${ComfyPrimitiveMapping[t]} | ComfyNodeOutput<'${t}'>`
         : `ComfyNodeOutput<'${t}'>`
   }

   toAcceptsType(t: string): string {
      return `ComfyNodeOutput<'${t}'>`
   }

   // #region discovery helpers
   /**
    * every possible value for a given slot, straight from the live schema.
    * e.g. schema.values('LoraLoader.lora_name') -> all loras on this host
    */
   values(slotName: string): ComfyUnionValue[] {
      return this.knownUnionBySlotName.get(asComfyNodeSlotName(slotName))?.values ?? []
   }

   /** string values only (most enums are), for quick discovery */
   stringValues(slotName: string): string[] {
      return this.values(slotName).filter((v): v is string => typeof v === 'string')
   }

   /**
    * for now, simply ensure that the number of parsed nodes matches the number
    * of nodes present in the object_info.json
    */
   RUN_BASIC_CHECKS = (): void => {
      const numNodesInSource = Object.keys(this.data.spec).length
      // +1: the injected UnknownNodeXX default schema
      const numNodesInSchema = this.nodes.length - 1
      if (numNodesInSource !== numNodesInSchema) {
         console.log(`🔴 parsed ${numNodesInSchema} nodes but object_info has ${numNodesInSource}`)
      }
   }

   hasEmbedding(embedding: string): embedding is EmbeddingName {
      return this.data.embeddings.includes(embedding)
   }

   hasLora(loraName: string): boolean {
      return this.getLoras().includes(loraName)
   }

   /** all loras on the host, optionally narrowed by a regex */
   getLoras = (filter?: RegExp): string[] => {
      const all = this.stringValues('LoraLoader.lora_name')
      return filter == null ? all : all.filter((n) => filter.test(n))
   }

   hasImage(imgName: string): imgName is ComfyImageName {
      return this.getImages().includes(imgName)
   }

   getImages = (): string[] => {
      return this.stringValues('LoadImage.image')
   }

   /**
    * only use this function after an upload success,
    * when you say this asset is now part of ComfyUI
    **/
   unsafely_addImageInSchemaWithoutReloading = (imgName: ComfyImageName): void => {
      const enumInfo = this.knownUnionBySlotName.get(asComfyNodeSlotName('LoadImage.image'))
      if (enumInfo == null) throw new Error(`LoadImage.image not found`)
      enumInfo.values.push(imgName)
   }

   hasCheckpoint(ckptName: string): boolean {
      return this.getCheckpoints().includes(ckptName)
   }

   getCheckpoints = (): string[] => {
      return this.stringValues('CheckpointLoaderSimple.ckpt_name')
   }
}
