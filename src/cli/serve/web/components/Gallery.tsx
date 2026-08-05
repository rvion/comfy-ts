// results, newest first: per-run delete + clear all; clicking any image (latent
// included) opens the LIGHTBOX (esc/backdrop closes; copy / open / delete
// inside). copy needs a secure context (localhost is one, LAN http is not) —
// the button hides where the clipboard api is absent
import { observer, useLocalObservable } from 'mobx-react-lite'
import { useEffect } from 'react'
import { runPreviewSrc } from 'src/cli/serve/web/api.ts'
import { copyImageToClipboard } from 'src/cli/serve/web/clipboard.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const canCopy = typeof navigator !== 'undefined' && navigator.clipboard != null

type LightboxTarget = { url: string; title: string; promptId: string | null }

type GalleryLocal = {
   copyNote: { url: string; text: string } | null
   lightbox: LightboxTarget | null
   setCopyNote(url: string, text: string): void
   openLightbox(target: LightboxTarget): void
   closeLightbox(): void
}

function useGalleryLocal(): GalleryLocal {
   return useLocalObservable<GalleryLocal>(() => ({
      copyNote: null,
      lightbox: null,
      setCopyNote(url: string, text: string) {
         this.copyNote = { url, text }
      },
      openLightbox(target: LightboxTarget) {
         this.lightbox = target
      },
      closeLightbox() {
         this.lightbox = null
      },
   }))
}

const Lightbox = observer(function Lightbox(p: { st: WebSt; local: GalleryLocal }) {
   const box = p.local.lightbox
   useEffect(() => {
      if (box == null) return
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Escape') p.local.closeLightbox()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [box, p.local])
   if (box == null) return null
   const copy = (): void => {
      copyImageToClipboard(box.url)
         .then(() => p.local.setCopyNote(box.url, 'copied ✓'))
         .catch((e: unknown) =>
            p.local.setCopyNote(box.url, `copy failed: ${e instanceof Error ? e.message : String(e)}`),
         )
   }
   return (
      <div className="modal-overlay" onClick={() => p.local.closeLightbox()}>
         <div className="lightbox" onClick={(e) => e.stopPropagation()}>
            <img src={box.url} alt={box.title} />
            <div className="lightbox-bar">
               <span className="hint" title={box.title}>
                  {box.title}
               </span>
               {canCopy ? (
                  <button type="button" onClick={copy}>
                     copy
                  </button>
               ) : null}
               <a href={box.url} target="_blank" rel="noreferrer">
                  open ↗
               </a>
               {box.promptId != null ? (
                  <button
                     type="button"
                     title="remove this result"
                     onClick={() => {
                        if (box.promptId != null) p.st.run.remove(box.promptId)
                        p.local.closeLightbox()
                     }}
                  >
                     delete
                  </button>
               ) : null}
               {p.local.copyNote?.url === box.url ? <span className="hint">{p.local.copyNote.text}</span> : null}
               <button type="button" title="close (esc)" onClick={() => p.local.closeLightbox()}>
                  ✕
               </button>
            </div>
         </div>
      </div>
   )
})

/** live card while a run is in flight: progress bar + the latest latent frame */
const RunningCard = observer(function RunningCard(p: { st: WebSt; local: GalleryLocal }) {
   // the RUNNING module, never the selection: switching modules mid-run must not retarget the card
   const moduleKey = p.st.run.runningModule
   if (!p.st.run.isRunning || moduleKey == null) return null
   const percent = p.st.run.progressPercent
   const previewUrl = runPreviewSrc({ module: moduleKey, tick: p.st.run.previewTick })
   return (
      <div className="run-card running">
         <div className="meta">
            <span>generating {moduleKey}…</span>
            <span>{percent != null ? `${Math.round(percent)}%` : ''}</span>
         </div>
         <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent ?? 0}%` }} />
         </div>
         {p.st.run.hasPreview ? (
            <div className="imgs">
               <button
                  type="button"
                  className="img-button"
                  onClick={() => p.local.openLightbox({ url: previewUrl, title: 'latent preview', promptId: null })}
               >
                  <img src={previewUrl} alt="latent preview" />
               </button>
            </div>
         ) : null}
      </div>
   )
})

export const Gallery = observer(function Gallery(p: { st: WebSt }) {
   const local = useGalleryLocal()
   if (p.st.run.results.length === 0 && !p.st.run.isRunning) return null
   return (
      <div className="gallery">
         <RunningCard st={p.st} local={local} />
         {p.st.run.results.length > 0 ? (
            <div className="gallery-head">
               <span>
                  {p.st.run.results.length} result{p.st.run.results.length === 1 ? '' : 's'}
               </span>
               <button type="button" className="link" onClick={() => p.st.run.clear()}>
                  clear all
               </button>
            </div>
         ) : null}
         {p.st.run.results.map((r) => (
            <div key={r.promptId} className="run-card">
               <div className="meta">
                  <span>
                     {r.at} · {r.module}/{r.draft} · {(r.durationMs / 1000).toFixed(1)}s
                     {Object.entries(r.seeds).map(([k, seed]) => ` · ${k}: ${seed}`)}
                  </span>
                  <button
                     type="button"
                     className="link"
                     title="remove this result"
                     onClick={() => p.st.run.remove(r.promptId)}
                  >
                     ✕
                  </button>
               </div>
               <div className="imgs">
                  {r.images.map((img) =>
                     img.url != null ? (
                        <button
                           key={img.filename}
                           type="button"
                           className="img-button"
                           title={img.filename}
                           onClick={() => {
                              if (img.url != null)
                                 local.openLightbox({ url: img.url, title: img.filename, promptId: r.promptId })
                           }}
                        >
                           <img src={img.url} alt={img.filename} />
                        </button>
                     ) : (
                        <div key={img.filename} className="noimg">
                           {img.filename} (not saved locally — no preview)
                        </div>
                     ),
                  )}
                  {r.images.length === 0 ? <div className="noimg">no image outputs</div> : null}
               </div>
            </div>
         ))}
         <Lightbox st={p.st} local={local} />
      </div>
   )
})
