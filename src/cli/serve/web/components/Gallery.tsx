// results, newest first: per-run delete + clear all; clicking any image (latent
// included) opens the LIGHTBOX (esc/backdrop closes; copy / open / delete
// inside). copy needs a secure context (localhost is one, LAN http is not) —
// the button hides where the clipboard api is absent
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { observer, useLocalObservable } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { runPreviewSrc } from 'src/cli/serve/web/api.ts'
import { lightboxView, type LightboxTarget } from 'src/cli/serve/web/state/lightbox.ts'
import { copyImageToClipboard } from 'src/cli/serve/web/clipboard.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const canCopy = typeof navigator !== 'undefined' && navigator.clipboard != null

type GalleryLocal = {
   copyNote: { url: string; text: string } | null
   lightbox: LightboxTarget | null
   /** lightbox zoom: 1 = fitted. Pan is only meaningful past 1 */
   zoom: number
   panX: number
   panY: number
   setCopyNote(url: string, text: string): void
   openLightbox(target: LightboxTarget): void
   closeLightbox(): void
   zoomBy(factor: number, at: { x: number; y: number }): void
   panBy(dx: number, dy: number): void
   resetZoom(): void
}

function useGalleryLocal(): GalleryLocal {
   return useLocalObservable<GalleryLocal>(() => ({
      copyNote: null,
      lightbox: null,
      zoom: 1,
      panX: 0,
      panY: 0,
      setCopyNote(url: string, text: string) {
         this.copyNote = { url, text }
      },
      openLightbox(target: LightboxTarget) {
         this.lightbox = target
         this.resetZoom()
      },
      closeLightbox() {
         this.lightbox = null
         this.resetZoom()
      },
      /** zoom around the CURSOR: the point under the pointer stays under it, which is what
       * makes wheel zoom usable — a centre-anchored zoom walks the detail off screen */
      zoomBy(factor: number, at: { x: number; y: number }) {
         const next = Math.min(8, Math.max(1, this.zoom * factor))
         if (next === this.zoom) return
         const ratio = next / this.zoom
         this.panX = at.x - (at.x - this.panX) * ratio
         this.panY = at.y - (at.y - this.panY) * ratio
         this.zoom = next
         if (next === 1) {
            this.panX = 0
            this.panY = 0
         }
      },
      panBy(dx: number, dy: number) {
         if (this.zoom === 1) return
         this.panX += dx
         this.panY += dy
      },
      resetZoom() {
         this.zoom = 1
         this.panX = 0
         this.panY = 0
      },
   }))
}

const Lightbox = observer(function Lightbox(p: { st: WebSt; local: GalleryLocal }) {
   const target = p.local.lightbox
   const box =
      target == null
         ? null
         : lightboxView({
              target,
              isRunning: p.st.run.isRunning,
              previewTick: p.st.run.previewTick,
              results: p.st.run.results,
           })
   useEffect(() => {
      if (target == null) return
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Escape') p.local.closeLightbox()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [target, p.local])
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
            <div
               className={p.local.zoom > 1 ? 'zoom-view grabbing' : 'zoom-view'}
               onWheel={(e) => {
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  // deltaY is per-line on some mice and per-pixel on others: sign only
                  p.local.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, {
                     x: e.clientX - rect.left - rect.width / 2,
                     y: e.clientY - rect.top - rect.height / 2,
                  })
               }}
               onDoubleClick={() => p.local.resetZoom()}
               onPointerDown={(e) => {
                  if (p.local.zoom === 1) return
                  e.currentTarget.setPointerCapture(e.pointerId)
               }}
               onPointerMove={(e) => {
                  if (e.buttons !== 1) return
                  p.local.panBy(e.movementX, e.movementY)
               }}
            >
               <img
                  src={box.url}
                  alt={box.title}
                  draggable={false}
                  style={{
                     transform: `translate(${p.local.panX}px, ${p.local.panY}px) scale(${p.local.zoom})`,
                  }}
               />
            </div>
            <div className="lightbox-bar">
               <span className="hint" data-tip={box.title}>
                  {box.title}
               </span>
               {p.local.zoom > 1 ? (
                  <button
                     type="button"
                     data-tip="back to fit (or double click the image)"
                     onClick={() => p.local.resetZoom()}
                  >
                     {p.local.zoom.toFixed(1)}× · fit
                  </button>
               ) : (
                  <span className="hint">scroll to zoom</span>
               )}
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
                     data-tip="remove this result"
                     onClick={() => {
                        if (box.promptId != null) p.st.run.remove(box.promptId)
                        p.local.closeLightbox()
                     }}
                  >
                     delete
                  </button>
               ) : null}
               {p.local.copyNote?.url === box.url ? <span className="hint">{p.local.copyNote.text}</span> : null}
               <button type="button" data-tip="close (esc)" onClick={() => p.local.closeLightbox()}>
                  <Icon name="close" />
               </button>
            </div>
         </div>
      </div>
   )
})

/** a reasoning model narrates inside <think> before it answers. The answer is what you asked
 * for, so it reads first and the thinking folds away — dropping it outright would hide the
 * only explanation of a bad answer */
function splitThinking(text: string): { thinking: string | null; answer: string } {
   const close = text.indexOf('</think>')
   if (close === -1) {
      // no closing tag: the whole budget went into reasoning and the answer never came
      return text.trimStart().startsWith('<think>')
         ? { thinking: text.replace(/^\s*<think>/, '').trim(), answer: '' }
         : { thinking: null, answer: text.trim() }
   }
   const thinking = text
      .slice(0, close)
      .replace(/^\s*<think>/, '')
      .trim()
   return { thinking: thinking === '' ? null : thinking, answer: text.slice(close + '</think>'.length).trim() }
}

/** a STRING output. An llm graph produces ONLY these, so a run card without them shows nothing */
const TextResult = observer(function TextResult(p: { entry: { nodeKey: string | null; text: string } }) {
   const local = useLocalObservable(() => ({
      showThinking: false,
      copied: false,
      toggle(): void {
         this.showThinking = !this.showThinking
      },
      markCopied(): void {
         this.copied = true
      },
   }))
   const { thinking, answer } = splitThinking(p.entry.text)
   return (
      <div className="run-text">
         <div className="run-text-head">
            <span className="hint">{p.entry.nodeKey ?? 'text'}</span>
            {thinking != null ? (
               <button
                  type="button"
                  className="link"
                  data-tip="the model's reasoning, before its answer"
                  onClick={() => local.toggle()}
               >
                  {local.showThinking ? 'hide thinking' : 'thinking'}
               </button>
            ) : null}
            {canCopy ? (
               <button
                  type="button"
                  className="link"
                  data-tip="copy this text"
                  onClick={() => {
                     void navigator.clipboard.writeText(answer === '' ? p.entry.text : answer)
                     local.markCopied()
                  }}
               >
                  <Icon name="copy" /> {local.copied ? 'copied' : ''}
               </button>
            ) : null}
         </div>
         {thinking != null && local.showThinking ? <pre className="run-thinking">{thinking}</pre> : null}
         {answer === '' ? (
            <div className="noimg">the model reasoned past its token budget and never answered — raise max tokens</div>
         ) : (
            <pre className="run-text-body">{answer}</pre>
         )}
      </div>
   )
})

/** text arriving DURING the node. It pins to the bottom because a stream grows downward and
 * the newest words are the ones you are reading */
const LiveText = observer(function LiveText(p: { text: string }) {
   const { thinking, answer } = splitThinking(p.text)
   const ref = useRef<HTMLPreElement>(null)
   useEffect(() => {
      const el = ref.current
      if (el != null) el.scrollTop = el.scrollHeight
   })
   // mid-stream the answer is usually still empty and the thinking IS the story, so whichever
   // one is live gets shown rather than a blank box under a "thinking" label
   const live = answer !== '' ? answer : (thinking ?? '')
   return (
      <div className="run-live">
         {answer === '' && thinking != null ? <span className="hint">thinking…</span> : null}
         <pre ref={ref} className={answer === '' ? 'run-live-body dim' : 'run-live-body'}>
            {live}
         </pre>
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
   // the node's OWN counter: generated tokens on a text node, sampler steps on a KSampler.
   // A text graph has no latent frame and no image, so without this its card is a bare bar
   const node = p.st.run.progressNode
   const count = p.st.run.progressCount
   const liveText = p.st.run.progressText
   return (
      <div className="run-card running">
         <div className="meta">
            <span>generating {moduleKey}…</span>
            <span>{percent != null ? `${Math.round(percent)}%` : ''}</span>
         </div>
         {node != null ? (
            <div className="run-node">
               {node}
               {count != null ? ` ${count.value}/${count.max}` : ''}
            </div>
         ) : null}
         {/* a node streaming its text as it produces it: the answer builds up here before the
             run ends. Same fold as a finished result, so watching and reading look alike */}
         {liveText != null && liveText !== '' ? <LiveText text={liveText} /> : null}
         <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent ?? 0}%` }} />
         </div>
         {p.st.run.hasPreview && p.st.showLatent ? (
            <div className="imgs">
               <button
                  type="button"
                  className="img-button"
                  onClick={() => p.local.openLightbox({ kind: 'latent', module: moduleKey })}
               >
                  <img src={previewUrl} alt="latent preview" />
               </button>
            </div>
         ) : null}
      </div>
   )
})

/** compact = the pinned corner: the newest result only, no header. It is a RENDER decision,
 * never a css one — hiding cards with :first-of-type counted div siblings, so the moment the
 * header appeared every card vanished and a finished image disappeared behind the latent */
export const Gallery = observer(function Gallery(p: { st: WebSt; compact?: boolean }) {
   const local = useGalleryLocal()
   if (p.st.run.results.length === 0 && !p.st.run.isRunning) return null
   const results = p.compact === true ? p.st.run.results.slice(0, 1) : p.st.run.results
   return (
      <div className="gallery">
         <RunningCard st={p.st} local={local} />
         {/* the count and clear-all moved onto the run line beside the generate button: two
             headers for one idea is a header too many */}
         {results.map((r) => (
            <div key={r.promptId} className="run-card">
               <div className="meta">
                  <span>
                     {r.at} · {r.module}/{r.draft} · {(r.durationMs / 1000).toFixed(1)}s
                     {Object.entries(r.seeds).map(([k, seed]) => ` · ${k}: ${seed}`)}
                  </span>
                  <button
                     type="button"
                     className="link"
                     data-tip="remove this result"
                     onClick={() => p.st.run.remove(r.promptId)}
                  >
                     <Icon name="trash" />
                  </button>
               </div>
               <div className="imgs">
                  {r.images.map((img) =>
                     img.url != null ? (
                        <button
                           key={img.filename}
                           type="button"
                           className="img-button"
                           data-tip={img.filename}
                           onClick={() => {
                              if (img.url != null)
                                 local.openLightbox({
                                    kind: 'image',
                                    url: img.url,
                                    title: img.filename,
                                    promptId: r.promptId,
                                 })
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
                  {r.images.length === 0 && (r.texts ?? []).length === 0 ? (
                     <div className="noimg">no outputs</div>
                  ) : null}
               </div>
               {(r.texts ?? []).map((t, ix) => (
                  <TextResult key={`${r.promptId}-${ix}`} entry={t} />
               ))}
            </div>
         ))}
         <Lightbox st={p.st} local={local} />
      </div>
   )
})
