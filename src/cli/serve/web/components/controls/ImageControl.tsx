// image: a path/url input the api already accepts, plus a browser upload
// (POST /upload → local file under outputs/serve-inputs/) and a preview when
// the value is browser-reachable
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { observer } from 'mobx-react-lite'
import { useRef } from 'react'
import { uploadFile } from 'src/cli/serve/web/api.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'

export const ImageControl = observer(function ImageControl(p: { v: VarSt }) {
   const fileInput = useRef<HTMLInputElement>(null)
   const value = typeof p.v.value === 'string' ? p.v.value : ''
   const previewUrl = /^https?:\/\//.test(value) ? value : p.v.uploadedUrl
   const extensions = p.v.desc.extensions ?? []
   const onFile = async (file: File | undefined): Promise<void> => {
      if (file == null) return
      try {
         const reply = await uploadFile({ file })
         p.v.set(reply.path)
         p.v.setUploadedUrl(reply.url)
      } catch (e) {
         // loud both ways: the row hint cannot show async errors, alert can
         alert(`upload failed: ${e instanceof Error ? e.message : String(e)}`)
      }
   }
   return (
      <div>
         <div className="row-inline">
            <input
               type="text"
               style={{ flex: 1 }}
               placeholder="local path or http(s) url"
               value={value}
               onChange={(e) => {
                  p.v.set(e.target.value)
                  p.v.setUploadedUrl(null)
               }}
            />
            <button type="button" onClick={() => fileInput.current?.click()}>
               upload…
            </button>
            {value !== '' ? (
               <button
                  type="button"
                  data-tip="clear the image"
                  onClick={() => {
                     p.v.set('')
                     p.v.setUploadedUrl(null)
                  }}
               >
                  <Icon name="close" />
               </button>
            ) : null}
            <input
               ref={fileInput}
               type="file"
               accept={extensions.map((ext) => `.${ext}`).join(',')}
               style={{ display: 'none' }}
               onChange={(e) => {
                  void onFile(e.target.files?.[0])
                  e.target.value = ''
               }}
            />
         </div>
         {previewUrl != null && previewUrl !== '' ? (
            <div className="img-preview">
               <img src={previewUrl} alt={value} />
            </div>
         ) : null}
      </div>
   )
})
