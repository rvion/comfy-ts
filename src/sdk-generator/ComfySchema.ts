import { ComfyUIObjectInfoParsed } from './ComfyUIObjectInfoParsed'
import type { ComfyUIObjectInfoParsedNodeSchema } from './ComfyUIObjectInfoParsedNodeSchema'
import type { ComfySchemaJSON } from './ComfyUIObjectInfoTypes'
import type {
   ComfyNodeSlotName,
   ComfyPythonModule,
   ComfyUnionInfo,
   EmbeddingName,
   NodeNameInComfy,
   NodeNameInCushy,
} from './comfyui-types'

export type ComfySchemaId = string

export type ComfySchemaData = {
   spec: ComfySchemaJSON
   embeddings: string[]
}

const emptyObjectInfo = Object.freeze({ id: 'empty', spec: {}, embeddings: [] })
const emptyObjectInfoParsed: ComfyUIObjectInfoParsed = new ComfyUIObjectInfoParsed(emptyObjectInfo)

/** wrapper around a give ComfySchemaJSON + list of embeddings */
export class ComfySchema {
   constructor(public data: ComfySchemaData) {}

   update(data: Partial<ComfySchemaData>): void {
      Object.assign(this.data, data)
      try {
         this.parseObjectInfo = new ComfyUIObjectInfoParsed(this.data)
      } catch (error) {
         this.isInvalid = true
         console.error(`❌ [ComfySchemaL.onUpdate] `, error)
      }
   }

   /**
    * return the number of nodes in your current schema
    * quick way to check your instance infos
    * */
   get size(): number {
      return Object.keys(this.data.spec).length
   }

   parseObjectInfo: ComfyUIObjectInfoParsed = emptyObjectInfoParsed

   // forward to underlying parsedObjectInfo
   get pythonModuleByNodeNameInCushy(): Map<NodeNameInCushy, ComfyPythonModule> {
      return this.parseObjectInfo.pythonModuleByNodeNameInCushy
   }

   get pythonModuleByNodeNameInComfy(): Map<NodeNameInComfy, ComfyPythonModule> {
      return this.parseObjectInfo.pythonModuleByNodeNameInComfy
   }

   get knownUnionBySlotName(): Map<ComfyNodeSlotName, ComfyUnionInfo> {
      return this.parseObjectInfo.knownUnionBySlotName
   }

   get nodes(): ComfyUIObjectInfoParsedNodeSchema[] {
      return this.parseObjectInfo.nodes
   }

   get nodesByNameInCushy(): Record<string, ComfyUIObjectInfoParsedNodeSchema> {
      return this.parseObjectInfo.nodesByNameInCushy
   }

   get nodesByNameInComfy(): Record<string, ComfyUIObjectInfoParsedNodeSchema> {
      return this.parseObjectInfo.nodesByNameInComfy
   }

   isInvalid: boolean = false
   onUpdate = (): void => {}

   /**
    * for now, simply ensure that the number of parsed nodes matches the number of nodes
    * present in the object_info.json
    */
   RUN_BASIC_CHECKS = (): void => {
      const numNodesInSource = Object.keys(this.data.spec).length
      const numNodesInSchema = this.nodes.length
      if (numNodesInSource !== numNodesInSchema) {
         console.log(`🔴 ${numNodesInSource} != ${numNodesInSchema}`)
      }
   }

   hasEmbedding(embedding: string): embedding is EmbeddingName {
      return this.data.embeddings.includes(embedding as EmbeddingName)
   }

   /**
    * check if the given lora name is present
    * in the Comfy.Union['E_LoraName'] type union
    **/
   hasLora(loraName: string): boolean {
      return this.getLoras().includes(loraName as Comfy.Slots['LoraLoader.lora_name'])
   }

   /** return the list of all loras available */
   getLoras = (): Comfy.Slots['LoraLoader.lora_name'][] => {
      const candidates = this.knownUnionBySlotName.get('LoraLoader.lora_name')?.values ?? []
      return candidates as Comfy.Slots['LoraLoader.lora_name'][]
   }

   hasImage(imgName: string): imgName is Comfy.Slots['LoadImage.image'] {
      return this.getImages().includes(imgName as Comfy.Slots['LoadImage.image'])
   }

   getImages = (): Comfy.Slots['LoadImage.image'][] => {
      const candidates = this.knownUnionBySlotName.get('LoadImage.image')?.values ?? []
      return candidates as Comfy.Slots['LoadImage.image'][]
   }

   /**
    * only use this function after an upload success,
    * when you say this asset is now part of ComfyUI
    **/
   unsafely_addImageInSchemaWithoutReloading = (imgName: string): void => {
      const enumInfo = this.knownUnionBySlotName.get('LoadImage.image')
      if (enumInfo == null) throw new Error(`LoadImage.image not found`)
      enumInfo.values.push(imgName as Comfy.Slots['LoadImage.image'])
   }

   // CHECKPOINT --------------------------------------------------------------
   hasCheckpoint(ckptName: string): ckptName is Comfy.Slots['CheckpointLoaderSimple.ckpt_name'] {
      return this.getCheckpoints().includes(ckptName as Comfy.Slots['CheckpointLoaderSimple.ckpt_name'])
   }

   getCheckpoints = (): Comfy.Slots['CheckpointLoaderSimple.ckpt_name'][] => {
      const candidates = this.knownUnionBySlotName.get('CheckpointLoaderSimple.ckpt_name')?.values ?? []
      return candidates as Comfy.Slots['CheckpointLoaderSimple.ckpt_name'][]
   }
}
