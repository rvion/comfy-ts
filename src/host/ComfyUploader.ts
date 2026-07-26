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

   /** upload a blob */
   uploadImage = async (
      //
      img: MediaImage,
      p: {
         type?: Maybe<'input' | 'temp' | 'output'>
         override?: Maybe<boolean>
         subfolder?: string
      },
   ): Promise<ComfyImageName> => {
      const uniqFileName = img.enumName as ComfyImageName
      // console.warn(`[🌁] UPLOAD: ${img.relPath} required as "${uniqFileName}"...`)

      const expectedFinalName = p.subfolder //
         ? `${p.subfolder}/${uniqFileName}`
         : uniqFileName
      // 2. if image already exists, return it
      if (this.host.schema.hasImage(expectedFinalName)) {
         console.log(`[🌁] UPLOAD: 🩶 "${img.absPath}" already exists on current ComfyUI instance`)
         return expectedFinalName as ComfyImageName
      }

      // 3. upload
      const form = new FormData()
      form.set('image', img.getAsBlob(), uniqFileName)
      if (p.type) form.set('type', p.type)
      if (p.override ?? true) form.set('override', 'true')
      // const subfolder = p.subfolder ?? 'comfyts-upload'
      if (p.subfolder) form.set('subfolder', p.subfolder)
      const uploadURL = this.host.getServerHostHTTP() + '/upload/image'
      const resp = await fetch(uploadURL, { method: 'POST', body: form })
      const result: ComfyUploadImageResult = softValidate(ComfyUploadImageResult_ark, await resp.json())

      // 4. check upload is successfull
      console.log('[🌁] UPLOAD: ✅ got', result)
      if (result.name == null) throw new Error('upload failed')

      const finalName = result.subfolder //
         ? (`${result.subfolder}/${result.name}` as ComfyImageName)
         : result.name

      if (finalName !== expectedFinalName) {
         console.warn(`[🌁] UPLOAD: ⚠️ expected "${expectedFinalName}" but got "${finalName}"`)
      } else {
         console.log(`[🌁] UPLOAD: ✅ finalName is "${finalName}"`)
      }

      // 5. patch the local ComfyUI schema locally
      this.host.schema.unsafely_addImageInSchemaWithoutReloading(finalName)

      // 6. return the image
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
