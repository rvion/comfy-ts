// the widgets every explorer page shares: a segmented choice, the source picker (drop, click,
// paste or a sample) and a card's body before its result shows.
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CardInfo, RunSt, Source } from './runs.ts'

export function Seg<T extends string | number>(p: {
   value: T
   options: [T, string][]
   onChange: (v: T) => void
   tips?: string[]
}) {
   return (
      <div className="seg">
         {p.options.map(([v, label], i) => (
            <button key={String(v)} className={v === p.value ? 'on' : ''} title={p.tips?.[i]} onClick={() => p.onChange(v)}>
               {label}
            </button>
         ))}
      </div>
   )
}

/** the source image: drop a file, click to pick one, paste anywhere on the page, or a sample */
export function SourcePicker(p: {
   source: Source | null
   samples: string[]
   onFile: (f: Blob, name: string) => void
   onSample: (name: string) => void
}) {
   const [drag, setDrag] = useState(false)
   const fileRef = useRef<HTMLInputElement>(null)
   const take = (f: File | undefined): void => {
      if (f != null && f.type.startsWith('image/')) p.onFile(f, f.name)
   }
   useEffect(() => {
      const onPaste = (e: ClipboardEvent): void => {
         take([...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/')))
      }
      window.addEventListener('paste', onPaste)
      return () => window.removeEventListener('paste', onPaste)
   })
   return (
      <>
         <div
            className={`drop ${drag ? 'over' : ''}`}
            onDragOver={(e) => {
               e.preventDefault()
               setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
               e.preventDefault()
               setDrag(false)
               take(e.dataTransfer.files[0])
            }}
            onClick={() => fileRef.current?.click()}
         >
            {p.source != null ? <img src={p.source.url} alt={p.source.name} /> : <span>drop an image</span>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files?.[0])} />
         </div>
         <div className="dim small">
            {p.source != null ? `${p.source.name} · ${p.source.width}×${p.source.height}` : ''}
            <br />
            drop, click or paste an image
         </div>
         <div className="samples">
            {p.samples.map((s) => (
               <img key={s} src={`/api/samples/${s}`} alt={s} title={s} onClick={() => p.onSample(s)} />
            ))}
         </div>
      </>
   )
}

/** a card's frame before its result: the missing files, a run button, queued, the timer, the error */
export const RunBody = observer(function RunBody(p: {
   model: CardInfo
   run: RunSt | undefined
   now: number
   canRun: boolean
   onRun: () => void
}): ReactNode {
   const r = p.run
   if (!p.model.ok)
      return (
         <div className="missing">
            <b>not on this host</b>
            {p.model.missingNodes.length > 0 && <span>nodes: {p.model.missingNodes.join(', ')}</span>}
            {p.model.missingFiles.map((f) => (
               <a key={f.file} href={f.url} target="_blank" rel="noreferrer">
                  models/{f.folder}/{f.file}
               </a>
            ))}
         </div>
      )
   if (r == null)
      return (
         <button className="ghost" onClick={p.onRun} disabled={!p.canRun}>
            run
         </button>
      )
   if (r.status === 'queued') return <span className="dim">queued</span>
   if (r.status === 'running')
      return (
         <span className="dim">
            <span className="spin" /> {((p.now - r.startedAt) / 1000).toFixed(1)} s
            {p.model.autoDownload && p.now - r.startedAt > 8000 && <small>first run downloads the weights</small>}
         </span>
      )
   if (r.status === 'error')
      return (
         <div className="err">
            <span>{r.error}</span>
            <button className="ghost" onClick={p.onRun}>
               retry
            </button>
         </div>
      )
   return null
})
