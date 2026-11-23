// image, audio, video: a path/url input the api already accepts, a browser upload (POST /upload
// → local file under outputs/serve-inputs/), and a DROP ZONE for desktop files and gallery
// outputs. The preview plays the var's own medium: a url as is, a local image through GET /thumb
// (which only serves what a served workflow declared, or what lies under its folder or the
// outputs). The workflow's presets are one-click tiles; one not on this machine is disabled
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { MediaPresetDescriptor } from 'src/cli/serve/describeVar.ts'
import { decodeDraggedOutput, OUTPUT_DRAG_MIME } from 'src/cli/serve/web/state/mediaDrop.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { MediaKind } from 'src/runner/mediaKinds.ts'

/** a drag we can take: one of our outputs, or files from the desktop. A row reorder is not one */
function isMediaDrag(e: DragEvent): boolean {
   const types = e.dataTransfer.types
   return types.includes(OUTPUT_DRAG_MIME) || types.includes('Files')
}

function Preview(p: { kind: MediaKind; url: string; alt: string; onError: () => void }): ReactNode {
   if (p.kind === 'audio') return <audio controls preload="metadata" src={p.url} onError={p.onError} />
   if (p.kind === 'video') return <video controls muted preload="metadata" src={p.url} onError={p.onError} />
   return <img src={p.url} alt={p.alt} onError={p.onError} />
}

/** the workflow's starting files: a thumbnail and a name each, one click to use it */
function Presets(p: { presets: MediaPresetDescriptor[]; value: string; onPick: (value: string) => void }): ReactNode {
   return (
      <div className="media-presets">
         {p.presets.map((preset) => (
            <button
               key={preset.label}
               type="button"
               className={`media-preset${preset.value === p.value ? ' sel' : ''}`}
               disabled={preset.missing === true}
               data-tip={preset.missing === true ? `${preset.label}: not on this machine (${preset.value})` : preset.value}
               onClick={() => p.onPick(preset.value)}
            >
               {preset.thumb != null ? <img src={preset.thumb} alt="" loading="lazy" /> : <span className="media-preset-none" />}
               <span>{preset.label}</span>
            </button>
         ))}
      </div>
   )
}

export const MediaControl = observer(function MediaControl(p: { v: VarSt; kind: MediaKind }) {
   const fileInput = useRef<HTMLInputElement>(null)
   const [over, setOver] = useState(false)
   const value = typeof p.v.value === 'string' ? p.v.value : ''
   const isUrl = /^https?:\/\//.test(value)
   const localThumb =
      p.kind === 'image' && value !== '' && !isUrl ? `/thumb?src=${encodeURIComponent(value)}&w=360` : null
   const previewUrl = isUrl ? value : (p.v.uploadedUrl ?? localThumb)
   // a local file /thumb refuses (outside the workflow's folders) says so instead of a broken image
   const [previewFailed, setPreviewFailed] = useState(false)
   useEffect(() => setPreviewFailed(false), [previewUrl])
   const presets = p.v.desc.mediaPresets ?? []
   const extensions = p.v.desc.extensions ?? []
   const onDrop = (e: DragEvent): void => {
      if (!isMediaDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      setOver(false)
      const raw = e.dataTransfer.getData(OUTPUT_DRAG_MIME)
      if (raw !== '') {
         const out = decodeDraggedOutput(raw)
         if (out == null) return p.v.setMediaError('that drop is not a gallery output this panel knows')
         void p.v.takeOutput(out)
         return
      }
      const file = e.dataTransfer.files[0]
      if (file != null) void p.v.takeFile(file)
   }
   return (
      <div
         className={`media-drop${over ? ' over' : ''}`}
         onDragOver={(e) => {
            if (!isMediaDrag(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setOver(true)
         }}
         onDragLeave={(e) => {
            // leaving for a child is not leaving the zone
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
            setOver(false)
         }}
         onDrop={onDrop}
      >
         <div className="row-inline">
            <input
               type="text"
               style={{ flex: 1 }}
               placeholder={`local ${p.kind} path or http(s) url`}
               value={value}
               onChange={(e) => {
                  p.v.set(e.target.value)
                  p.v.setUploadedUrl(null)
                  p.v.setMediaError(null)
               }}
            />
            <button type="button" disabled={p.v.mediaBusy} onClick={() => fileInput.current?.click()}>
               {p.v.mediaBusy ? 'uploading…' : 'upload…'}
            </button>
            {value !== '' ? (
               <button
                  type="button"
                  data-tip={`clear the ${p.kind}`}
                  onClick={() => {
                     p.v.set('')
                     p.v.setUploadedUrl(null)
                     p.v.setMediaError(null)
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
                  const file = e.target.files?.[0]
                  if (file != null) void p.v.takeFile(file)
                  e.target.value = ''
               }}
            />
         </div>
         <div className="hint media-drop-hint">
            drop a {p.kind} file here, or drag one from the results (or use its <b>→ {p.v.name}</b> button)
         </div>
         {presets.length > 0 ? (
            <Presets presets={presets} value={value} onPick={(v) => {
               p.v.set(v)
               p.v.setUploadedUrl(null)
               p.v.setMediaError(null)
            }} />
         ) : null}
         {p.v.mediaError != null ? <div className="error">{p.v.mediaError}</div> : null}
         {previewUrl != null && previewUrl !== '' && !previewFailed ? (
            <div className={`img-preview media-preview-${p.kind}`}>
               <Preview kind={p.kind} url={previewUrl} alt={value} onError={() => setPreviewFailed(true)} />
            </div>
         ) : null}
         {previewFailed ? <div className="hint">no preview: the panel shows files of the workflow's folders, the outputs and the presets</div> : null}
      </div>
   )
})
