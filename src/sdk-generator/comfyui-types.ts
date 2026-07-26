import type { Branded } from 'src/types/index.ts'
import type { ComfyInputOpts } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'

export type ComfyUnionHash = string //  '26c34bf761d4be4554ab944105c5a3c017c99453
export type ComfyUnionName = string // 'E_26c34bf761d4be4554ab944105c5a3c017c99453'
export type ComfyUnionValue = string | boolean | number

export type ComfyPythonModule = string
export type NodeNameInComfy = string
export type QualifiedNodeKey = string

/**
 * the textual name of a slot type (slot = input or output of a node),
 * e.g. 'MODEL', 'IMAGE', 'E_CkptName'.
 * Branded string — internals never depend on the global Comfy namespace
 * (that would break host encapsulation: slot types are per-host).
 */
export type ComfyNodeSlotTypeName = Branded<string, { SlotTypeName: true }>
export const asComfyNodeSlotTypeName = (x: string): ComfyNodeSlotTypeName => x as ComfyNodeSlotTypeName

/** a fully-qualified slot name, e.g. 'LoadImage.image' or 'KSampler.LATENT.OUT' */
export type ComfyNodeSlotName = Branded<string, { SlotName: true }>
export const asComfyNodeSlotName = (x: string): ComfyNodeSlotName => x as ComfyNodeSlotName

export type EmbeddingName = Branded<string, { Embedding: true }>

export type NodeInputExt = {
   slotName: ComfyNodeSlotName
   nameInComfy: string
   nameInComfyEscaped: string
   typeName: ComfyNodeSlotTypeName
   opts?: ComfyInputOpts
   isPrimitive: boolean
   isEnum: boolean
   required: boolean
   index: number
}

export type NodeOutputExt = {
   slotName: ComfyNodeSlotName
   typeName: ComfyNodeSlotTypeName
   outKey: string
   nameInComfy: string
   isPrimitive: boolean
}

export type ComfyUnionInfo = {
   hash: ComfyUnionHash
   unionName: ComfyUnionName
   values: ComfyUnionValue[]
   enumNames: ComfyNodeSlotName[]
}

/** an image file name as known by the host (hash-named upload or existing input) */
export type ComfyImageName = Branded<string, { ComfyImageName: true }>
export const asComfyImageName = (x: string): ComfyImageName => x as ComfyImageName
