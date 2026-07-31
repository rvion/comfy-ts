import { type } from 'arktype'
import { type ImageMeta, imageMeta } from 'image-meta'
import { basename } from 'pathe'
import type { Sharp } from 'sharp'
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import { importSharp } from 'src/utils/lazySharp.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { ComfyNodeMetadata } from 'src/graph/ComfyNodeID.ts'
import type { ComfyApiNodeJson } from 'src/sdk-generator/comfy-api-json.ts'
import { type AbsolutePath, asAbsolutePath, type Maybe } from 'src/types/index.ts'
import type { NodeOf } from 'src/types/comfy-sdk.ts'
import type { ComfyImageName } from 'src/sdk-generator/comfyui-types.ts'
import { bang } from 'src/utils/bang.ts'
import { hashArrayBuffer } from 'src/utils/hashArrayBuffer.ts'
import type { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import { type ComfyImageInfo, ComfyImageInfo_ark } from 'src/runner/ComfyWsApi.ts'
import { ComfyNode } from 'src/graph/ComfyNode.ts'

/** base64 image loader nodes we know how to wire, in preference order — each
 * verified against a real object_info dump before entering the table */
export const BASE64_IMAGE_LOADERS: { nameInComfy: string; inputs: (b64: string) => ComfyApiNodeJson['inputs'] }[] = [
   // comfyui-tooling-nodes: outputs IMAGE + MASK (alpha)
   { nameInComfy: 'ETN_LoadImageBase64', inputs: (b64) => ({ image: b64 }) },
   // ComfyUI-Easy-Use: image_output 'Hide' + empty prefix so the node itself saves nothing
   {
      nameInComfy: 'easy loadImageBase64',
      inputs: (b64) => ({ base64_data: b64, image_output: 'Hide', save_prefix: '' }),
   },
]

export type MediaImageData = {
   /** absent = in-memory image (ws output with local saving off) — the buffer is then required */
   path?: Maybe<AbsolutePath>

   // to avoid having to read the file if we already have the buffer around
   buffer?: Uint8Array

   // provenance ?
   execution?: ComfyExecution
   promptNodeID?: string | null

   comfyUIInfos?: ImageInfos_ComfyGenerated
}

export type ImageInfos_ComfyGenerated = {
   comfyHostHttpURL: string
   comfyImageInfo: ComfyImageInfo
}

export const ImageInfos_ComfyGenerated_ark = type({
   comfyHostHttpURL: 'string',
   comfyImageInfo: ComfyImageInfo_ark,
})

export class MediaImage {
   /** null for in-memory images (local saving is opt-in — architecture.md item 14) */
   absPath: AbsolutePath | null

   /** the execution this image came from (null when not generated via comfy-ts) */
   execution: Maybe<ComfyExecution>

   /** return the workflow from which this image was generated */
   get workflow(): ComfyWorkflow | undefined {
      return this.execution?.workflow
   }

   promptNodeID: Maybe<string>

   constructor(data: MediaImageData) {
      this.absPath = data.path ?? null
      this.execution = data.execution
      this.promptNodeID = data.promptNodeID
      if (data.path == null && data.buffer == null)
         throw new Error('❌ MediaImage: an in-memory image (no path) requires a buffer')
      if (data.buffer != null) this.updateBuffer(data.buffer)
   }

   /** free-form labels; filled from ComfyNodeMetadata.tag(s) when generated via a prompt */
   tags: string[] = []

   /** the image as a Blob, e.g. to feed FormData uploads */
   getAsBlob(): Blob {
      return new Blob([this.buffer as Uint8Array<ArrayBuffer>], { type: `image/${this.metadata.type ?? 'png'}` })
   }

   /** return the image filename (in-memory images get a stable hash-derived name) */
   get filename(): string {
      if (this.absPath != null) return basename(this.absPath)
      return `image-${this.hash.slice(0, 8)}.${this.metadata.type ?? 'png'}`
   }

   get baseNameWithoutExtension(): string {
      const fname = this.filename
      return fname.slice(0, fname.lastIndexOf('.'))
   }

   /**
    * return file extension including dot
    * e.g. `.png`, or `.webp`
    * */
   get extension(): string {
      const fname = this.filename
      return fname.slice(((fname.lastIndexOf('.') - 1) >>> 0) + 1)
   }

   /** get the expected enum name (hash) */
   get enumName(): ComfyImageName {
      return `${this.hash}${this.extension}` as ComfyImageName
   }

   uploadAndReturnEnumName = async (host: ComfyHost): Promise<ComfyImageName> => {
      const finalName = await host.uploader.uploadImage(this, { type: 'input', override: true })
      return finalName
   }

   /** upload the media (hash-named, deduped) and load it in the given workflow as a `LoadImage` node */
   loadInWorkflow_viaLoadImageNode = async <WID extends string>(
      workflow: ComfyWorkflow<WID>,
   ): Promise<NodeOf<WID, 'LoadImage'>> => {
      const enumName = await this.uploadAndReturnEnumName(workflow.host)
      const img = bang(workflow.builderBase.LoadImage, 'host has no LoadImage node')({ image: enumName })
      // sanctioned cast: uploaded names are runtime-known; the node itself is the host's LoadImage
      return img as NodeOf<WID, 'LoadImage'>
   }

   /** load an image as mask in a comfy workflow beeing created */
   loadInWorkflowAsMask_viaLoadImageMask = async <WID extends string>(
      /** "alpha" | "blue" | "green" | "red" */
      channel: 'alpha' | 'blue' | 'green' | 'red',
      /** workflow to load image as mask into */
      workflow: ComfyWorkflow<WID>,
   ): Promise<NodeOf<WID, 'LoadImageMask'>> => {
      const enumName = await this.uploadAndReturnEnumName(workflow.host)
      const mask = bang(
         workflow.builderBase.LoadImageMask,
         'host has no LoadImageMask node',
      )({
         image: enumName,
         channel,
      })
      // sanctioned cast: same as above
      return mask as NodeOf<WID, 'LoadImageMask'>
   }

   /** load this image into the workflow WITHOUT any server-side file: the
    * image rides base64 inside the prompt JSON (architecture.md item 14 —
    * the prompt still enters server history; `scrubHistory` covers that).
    * Feature-detected against the host schema; no supported node = loud throw. */
   loadInWorkflow_viaBase64Node = <WID extends string>(workflow: ComfyWorkflow<WID>): NodeOf<WID, 'LoadImage'> => {
      const schema = workflow.host.schema
      const entry = BASE64_IMAGE_LOADERS.find((t) => schema.nodes.some((n) => n.nameInComfy === t.nameInComfy))
      if (entry == null) {
         throw new Error(
            `❌ host '${workflow.host.data.id}' has no base64 image loader node ` +
               `(looked for: ${BASE64_IMAGE_LOADERS.map((t) => `'${t.nameInComfy}'`).join(', ')}). ` +
               `Install one (e.g. comfyui-tooling-nodes) or fall back to loadInWorkflow_viaLoadImageNode (uploads persist server-side).`,
         )
      }
      const node = new ComfyNode(
         workflow,
         (workflow._uidNumber++).toString(),
         { class_type: entry.nameInComfy, inputs: entry.inputs(this.getBase64Payload()) },
         {},
      )
      // sanctioned cast (family 1, like the two sibling loaders): both table
      // nodes output IMAGE+MASK, the LoadImage face is the shape consumers wire
      return node as NodeOf<WID, 'LoadImage'>
   }

   /** return the json of the ComfyNode that led to this image */
   get ComfyNode(): Maybe<ComfyApiNodeJson> {
      const nodeID = this.promptNodeID
      if (nodeID == null) return null
      return this.workflow?.apiJson[nodeID]
   }

   /**
    * return the metadata of the ComfyNode that led to this image
    * null if not generated by comfy through a ComfyTS prompt
    * null if no metadata associated in the node in ComfyTS
    */
   get ComfyNodeMetadata(): Maybe<ComfyNodeMetadata> {
      const nodeID = this.promptNodeID
      if (nodeID == null) return null
      return this.workflow?.data.metadata[nodeID]
   }

   get width(): number | undefined {
      return this.metadata.width
   } // biome-ignore format: misc
   get height(): number | undefined {
      return this.metadata.height
   } // biome-ignore format: misc

   get width_orCrash(): number {
      return bang(this.metadata.width)
   } // biome-ignore format: misc
   get height_orCrash(): number {
      return bang(this.metadata.height)
   } // biome-ignore format: misc

   /**
    * return the base64 url for this file, regardless of it's exact representation
    * includes the prefix `data:image/<type>;base64,`
    */
   getBase64Url(): string {
      const imgType = this.metadata.type ?? 'png'
      return `data:image/${imgType};base64,${this.getBase64Payload()}`
   }

   /**
    * return the base64 url for this file, regardless of it's exact representation
    * does not includes the prefix `data:image/png;base64,`
    */
   getBase64Payload(): string {
      const bytes = this.buffer
      let bin = ''
      const chunk = 0x8000 // String.fromCharCode arg-count limit
      for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
      return btoa(bin)
   }

   /** return the ArrayBuffer for this file, regardless it's exact representation  */

   /** lazilly loaded, call recomputeMetadata to expire */
   private _buffer: Maybe<Uint8Array> = null
   get buffer(): Uint8Array {
      if (this._buffer != null) return this._buffer
      this._buffer = getComfyStorage().readBytes(bang(this.absPath, 'in-memory MediaImage lost its buffer'))
      return this._buffer
   }
   /** no-op on in-memory images: the buffer is the only copy */
   freeBuffer = (): void => {
      if (this.absPath != null) this._buffer = null
   }
   updateBuffer = (buff: Uint8Array): void => {
      this._buffer = buff
      this._metadata = null // expire metadata
      this._hash = null // expire hash
   }
   reloadBuffer = (): Uint8Array => {
      this._buffer = null // expire buffer
      this._metadata = null // expire metadata
      this._hash = null // expire hash
      return this.buffer
   }

   /** lazilly computed, call recomputeMetadata to expire */
   private _metadata: Maybe<ImageMeta> = null
   get metadata(): ImageMeta {
      if (this._metadata != null) return this._metadata
      this._metadata = imageMeta(this.buffer)
      return this._metadata
   }

   private _hash: Maybe<string> = null
   get hash(): string {
      if (this._hash != null) return this._hash
      this._hash = hashArrayBuffer(this.buffer)
      return this._hash
   }

   /**
    * Modify the image directly (inplace) by passing it though a `Sharp` pipeline
    * Sharp is a high performance image processing library.
    */
   processWithSharp_inplace = async (
      /** processing function */
      fn: (sharp: Sharp) => Sharp,
   ): Promise<this> => {
      const sharp = await importSharp('processWithSharp_inplace')
      const buff = await fn(sharp(this.buffer)).toBuffer()
      if (this.absPath != null) getComfyStorage().writeBytes(this.absPath, new Uint8Array(buff))
      this.updateBuffer(new Uint8Array(buff))
      return this
   }

   /**
    * Allow to run an image though some `Sharp` pipeline to produce an other image.
    * Sharp is a high performance image processing library.
    * to modify the image directly (inplace), use `processWithSharp_inplace` instead.
    */
   processWithSharp = async (
      /** processing function */
      fn: (sharp: Sharp) => Sharp,
      /** where to save the resulting image */
      path?: AbsolutePath,
   ): Promise<MediaImage> => {
      const sharp = await importSharp('processWithSharp')
      path ??=
         this.absPath != null ? asAbsolutePath(this.absPath + `.processed-${Date.now()}` + this.extension) : undefined
      const buffer = new Uint8Array(await fn(sharp(this.buffer)).toBuffer())
      if (path != null) getComfyStorage().writeBytes(path, buffer)
      return new MediaImage({ path, buffer })
   }
}
