import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { frameClient } from 'rvlib-shipkit/src/pages/frame-client.ts'
import { WorldSt, type View } from './state.ts'
import { sendThumb } from './thumb.ts'
import { Viewer } from './viewer.ts'

// one world of .comfy-ts/worlds, the view page of the `world` thread kind (agent/examples.md, world-explorer). Framed by
// the hub or alone at its url: the frame client hands it its keys either way

const LABEL: Record<View, string> = { pano: '360°', world: 'walk', splat: 'splat', source: 'picture' }
const HINT: Record<View, string> = {
   pano: 'drag to look around · wheel or pinch to zoom',
   world: 'drag to look · right drag or shift to pan · WASD to walk, Q E down and up · wheel to go forward',
   splat: 'drag to orbit · right drag or shift to pan · WASD to fly, Q E down and up · wheel to go forward',
   source: '',
}

/** the page's own full screen, for the page opened alone: in the hub's lightbox (`mode=lightbox`) the hub fills the
 * window and closes it. Esc leaves it (the browser's own key); F toggles it */
async function toggleFull(): Promise<void> {
   if (st.mode === 'lightbox') return
   if (document.fullscreenElement != null) return void (await document.exitFullscreen())
   try {
      await document.documentElement.requestFullscreen()
   } catch (e) {
      st.setNotice(`full screen refused here: ${(e as Error).message}`)
      setTimeout(() => st.setNotice(null), 4000)
   }
}
document.addEventListener('fullscreenchange', () => st.setFull(document.fullscreenElement != null))
window.addEventListener('keydown', (e) => {
   if (e.key === 'Escape' && document.fullscreenElement != null) void document.exitFullscreen()
})

let viewer: Viewer | null = null
const st = new WorldSt((k) => frame.setKeys(k))
// alone at its url, the client hands the address's keys at once: the state exists first
const frame = frameClient({ onKeys: (k) => st.fromKeys(k), onFocus: (on) => viewer?.setRunning(on) })
// console debugging path (app-state-tree: expose the root)
Object.assign(window, { world: st })

const shotReady = (on: boolean): void =>
   document.querySelector('meta[name="shot-ready"]')?.setAttribute('content', on ? 'ready' : 'wait')

const Stage = observer(function Stage() {
   const host = useRef<HTMLDivElement>(null)
   useEffect(() => {
      if (host.current == null) return
      viewer = new Viewer(
         st,
         host.current,
         () => shotReady(true),
         () => void toggleFull(),
      )
      return () => viewer?.stop()
   }, [])
   const shown = st.shown
   const src = shown === 'source' ? st.fileUrl('source') : null
   useEffect(() => shotReady(shown === 'source'), [shown])
   return (
      <div ref={host} className="stage">
         {src != null ? (
            <img
               src={src}
               alt={st.name}
               draggable={false}
               onLoad={(e) => {
                  const img = e.currentTarget
                  if (!st.wantsThumb || st.thumbView !== 'source') return
                  st.thumbSent()
                  sendThumb(st.name, img, img.naturalWidth, img.naturalHeight).catch((x: unknown) =>
                     st.setNotice((x as Error).message),
                  )
               }}
            />
         ) : null}
         {st.error != null ? (
            <div className="note">{st.error}</div>
         ) : st.loading != null ? (
            <div className="note">loading {st.loading}…</div>
         ) : null}
         {st.name === '' && st.standalone ? <Worlds /> : null}
         {shown != null && HINT[shown] && !st.touched && st.loading == null && st.mode !== 'thumb' ? (
            <div className="hint">{HINT[shown]}</div>
         ) : null}
         {st.notice != null && st.mode !== 'thumb' ? <div className="hint notice">{st.notice}</div> : null}
      </div>
   )
})

const Worlds = observer(function Worlds() {
   return (
      <div className="note worlds">
         <div>
            {st.all.map((w) => (
               <a key={w.name} href={`?key=${w.name}`}>
                  {w.name}
               </a>
            ))}
         </div>
      </div>
   )
})

const App = observer(function App() {
   const shown = st.shown
   // the hub's still: the scene alone, no bar, no hint
   if (st.mode === 'thumb')
      return (
         <div className="app thumb">
            <Stage />
         </div>
      )
   return (
      <div className="app">
         <div className="bar">
            {/* tabs only when the page is opened alone: in a thread the hub switches views, one still per view */}
            {(st.standalone ? st.views : []).map((v) => (
               <button key={v} className={`tab${v === shown ? ' on' : ''}`} onClick={() => st.setView(v)}>
                  {LABEL[v]}
               </button>
            ))}
            <span className="line">
               <b>{st.name || 'worlds'}</b>
               {st.side ? ` · ${st.side}` : ''}
            </span>
            <span className="tools">
               {shown != null && shown !== 'source' ? (
                  <button className="tab" title="R, or a double click" onClick={() => st.reset()}>
                     reset view
                  </button>
               ) : null}
               {st.mode === 'lightbox' ? null : (
                  <button className="tab" title={st.full ? 'Esc' : 'F'} onClick={() => void toggleFull()}>
                     {st.full ? '✕ close' : '⤢ full screen'}
                  </button>
               )}
            </span>
         </div>
         <Stage />
      </div>
   )
})

void st.boot()
const rootEl = document.getElementById('root')
if (rootEl == null) throw new Error('#root missing from index.html')
createRoot(rootEl).render(<App />)
