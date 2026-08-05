// results, newest first: per-run delete + clear all, per-image copy (clipboard
// wants png, clipboard.ts re-encodes) and open-in-tab
import { observer, useLocalObservable } from 'mobx-react-lite'
import { runPreviewSrc } from 'src/cli/serve/web/api.ts'
import { copyImageToClipboard } from 'src/cli/serve/web/clipboard.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

/** live card while a run is in flight: progress bar + the latest latent frame */
const RunningCard = observer(function RunningCard(p: { st: WebSt }) {
   const moduleKey = p.st.form?.moduleKey
   if (!p.st.run.isRunning || moduleKey == null) return null
   const percent = p.st.run.progressPercent
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
               <img src={runPreviewSrc({ module: moduleKey, tick: p.st.run.previewTick })} alt="latent preview" />
            </div>
         ) : null}
      </div>
   )
})

export const Gallery = observer(function Gallery(p: { st: WebSt }) {
   const local = useLocalObservable(() => ({
      /** url → 'copied' | error text, cleared on the next copy */
      copyNote: null as { url: string; text: string } | null,
      setCopyNote(url: string, text: string) {
         this.copyNote = { url, text }
      },
   }))
   const copy = (url: string): void => {
      copyImageToClipboard(url)
         .then(() => local.setCopyNote(url, 'copied ✓'))
         .catch((e: unknown) => local.setCopyNote(url, `copy failed: ${e instanceof Error ? e.message : String(e)}`))
   }
   if (p.st.run.results.length === 0 && !p.st.run.isRunning) return null
   return (
      <div className="gallery">
         <RunningCard st={p.st} />
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
                        <div key={img.filename} className="img-cell">
                           <a href={img.url} target="_blank" rel="noreferrer">
                              <img src={img.url} alt={img.filename} title={img.filename} />
                           </a>
                           <div className="img-actions">
                              <button type="button" onClick={() => copy(img.url ?? '')}>
                                 copy
                              </button>
                              <a href={img.url} target="_blank" rel="noreferrer">
                                 open ↗
                              </a>
                              {local.copyNote?.url === img.url ? (
                                 <span className="hint">{local.copyNote.text}</span>
                              ) : null}
                           </div>
                        </div>
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
      </div>
   )
})
