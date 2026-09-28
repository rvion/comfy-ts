import { type } from 'arktype'
import type { ComfyImageName } from 'src/sdk-generator/comfyui-types.ts'
import type { MediaImage } from 'src/runner/MediaImage.ts'
import type { Maybe } from 'src/types/index.ts'
import { softValidate } from 'src/utils/softValidate.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'

export type ComfyUploadImageResult = {
   name: ComfyImageName
   subfolder: string
   type: string
}

export const ComfyUploadImageResult_ark = type({
   name: type.string.as<ComfyImageName>(),
   subfolder: 'string',
   type: 'string',
})

/** all those functions are kinda legacy */
export class ComfyUploader {
   constructor(public host: ComfyHost) {}

   /** names this process already uploaded to this host: a LoadAudio or LoadVideo list is not
    * reloaded after an upload, so without it every run re-sent the same file */
   private uploaded = new Set<string>()

   /** upload an image (hash-named, deduped against the host's LoadImage list) */
   uploadImage = async (
      //
      img: MediaImage,
      p: {
         type?: Maybe<'input' | 'temp' | 'output'>
         override?: Maybe<boolean>
         subfolder?: string
      },
   ): Promise<ComfyImageName> => {
      const name = await this.uploadInput({ blob: img.getAsBlob(), name: img.enumName, ...p, slot: 'LoadImage.image' })
      return name as ComfyImageName
   }

   /**
    * THE upload path: any file a loader node reads from the host's input folder. ComfyUI routes
    * audio and video through `/upload/image` too. `slot` is the loader input whose value list
    * says the file is already there (`LoadImage.image`, `LoadAudio.audio`, `LoadVideo.file`)
    */
   uploadInput = async (p: {
      blob: Blob
      /** the name the file should get on the host, hash-derived by callers so reruns dedupe */
      name: string
      slot: string
      type?: Maybe<'input' | 'temp' | 'output'>
      override?: Maybe<boolean>
      subfolder?: string
   }): Promise<string> => {
      const expectedFinalName = p.subfolder ? `${p.subfolder}/${p.name}` : p.name
      if (this.uploaded.has(expectedFinalName) || this.host.schema.stringValues(p.slot).includes(expectedFinalName)) {
         console.log(`[🌁] UPLOAD: 🩶 "${expectedFinalName}" already exists on current ComfyUI instance`)
         return expectedFinalName
      }

      const form = new FormData()
      form.set('image', p.blob, p.name)
      if (p.type) form.set('type', p.type)
      if (p.override ?? true) form.set('override', 'true')
      if (p.subfolder) form.set('subfolder', p.subfolder)
      const resp = await this.host.fetch('/upload/image', { method: 'POST', body: form })
      const result: ComfyUploadImageResult = softValidate(ComfyUploadImageResult_ark, await resp.json())

      console.log('[🌁] UPLOAD: ✅ got', result)
      if (result.name == null) throw new Error(`upload of '${p.name}' failed: the host answered no name`)

      const finalName = result.subfolder ? `${result.subfolder}/${result.name}` : result.name
      if (finalName !== expectedFinalName)
         console.warn(`[🌁] UPLOAD: ⚠️ expected "${expectedFinalName}" but got "${finalName}"`)

      // the image list IS a known union: patch it so the next LoadImage typechecks against it
      if (p.slot === 'LoadImage.image')
         this.host.schema.unsafely_addImageInSchemaWithoutReloading(finalName as ComfyImageName)
      this.uploaded.add(finalName)
      return finalName
   }

   /** upload an image present on disk to ComfyUI */
   // ⏸️ upload_FileAtAbsolutePath = async (filePath: AbsolutePath): Promise<ComfyUploadImageResult> => {
   // ⏸️     const mime = asSTRING_orCrash(lookup(filePath))
   // ⏸️     const file = new Blob([readFileSync(filePath)], { type: mime })
   // ⏸️     return await this.upload_Blob(file)
   // ⏸️ }

   // ⏸️ /** upload an image from dataURL */
   // ⏸️ upload_dataURL = async (dataURL: string): Promise<ComfyUploadImageResult> => {
   // ⏸️     const mime = dataURL.split(';')[0].split(':')[1]
   // ⏸️     console.log('[⬆️] upload_dataURL', mime)
   // ⏸️     const file = new Blob([Buffer.from(dataURL.split(',')[1], 'base64')], { type: mime })
   // ⏸️     return await this.upload_Blob(file)
   // ⏸️ }

   // ⏸️ /** upload an image present on disk to ComfyUI */
   // ⏸️ upload_NativeFile = async (file: File): Promise<ComfyUploadImageResult> => {
   // ⏸️     const blob = new Blob([await file.arrayBuffer()], { type: file.type })
   // ⏸️     return await this.upload_Blob(blob)
   // ⏸️ }

   // ⏸️ /** upload an image that can be downloaded form a given URL to ComfyUI */
   // ⏸️ upload_ImageAtURL = async (url: string): Promise<ComfyUploadImageResult> => {
   // ⏸️     const blob: Blob = await this.st.getUrlAsBlob(url)
   // ⏸️     return this.upload_Blob(blob)
   // ⏸️ }

   // ⏸️ /** upload a deck asset to ComfyUI */
   // ⏸️ upload_Asset = async (assetName: RelativePath): Promise<ComfyUploadImageResult> => {
   // ⏸️     const absPath = asAbsolutePath(path.join(this.st.rootPath, assetName))
   // ⏸️     return this.st.uploader.upload_FileAtAbsolutePath(absPath)
   // ⏸️ }
}
