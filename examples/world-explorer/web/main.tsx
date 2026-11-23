import { compareStructural, reaction } from 'mobx'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { frameClient } from 'rvlib-shipkit/src/pages/frame-client.ts'
import { camText, View3d, type Space } from 'rvlib-shipkit/src/view3d/viewer.ts'
import { WorldSt, type View } from './state.ts'
import { sendThumb } from './thumb.ts'

// one world of .comfy-ts/worlds, the view page of the `world` thread kind (agent/examples.md, world-explorer). Framed by
// the hub or alone at its url: the frame client hands it its keys either way

/** the house viewer's space for each 3D view; `source` is a flat picture, no viewer */
const SPACE: Record<Exclude<View, 'source'>, Space> = { pano: 'pano', world: 'mesh', splat: 'splat' }
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
   if (e.code === 'KeyF' && !e.altKey && !e.metaKey && !e.ctrlKey) void toggleFull()
})

let viewer: View3d | null = null
const st = new WorldSt((k) => frame.setKeys(k))
// alone at its url, the client hands the address's keys at once: the state exists first. A camera from the keys
// (the other side of a change) is set on the viewer; one equal to its own is left alone, so a glide goes on
const frame = frameClient({
   onKeys: (k) => {
      st.fromKeys(k)
      if (viewer != null && camText(viewer.cam) !== camText(st.cam)) viewer.setCam(st.cam)
   },
})
// console debugging path (app-state-tree: expose the root)
Object.assign(window, { world: st })

const shotReady = (on: boolean): void =>
   document.querySelector('meta[name="shot-ready"]')?.setAttribute('content', on ? 'ready' : 'wait')

/** a world's view drawn once: the shot's ready mark, and its thumbnail when it has none and he has not moved yet */
function drawn(v: View3d): void {
   shotReady(true)
   if (!st.wantsThumb || st.shown !== st.thumbView || st.touched) return
   const c = v.renderer.domElement
   st.thumbSent()
   // right after the frame is drawn: the canvas still holds it
   sendThumb(st.name, c, c.width, c.height).catch((e: unknown) => st.setNotice((e as Error).message))
}

/** the 3D views through the house viewer: one viewer while a 3D tab shows, each tab's file loaded into it */
const Scene = observer(function Scene() {
   const host = useRef<HTMLDivElement>(null)
   useEffect(() => {
      const el = host.current
      if (el == null) return
      const v: View3d = new View3d(el, {
         keys: 'window',
         onCam: (c) => st.setCam(c),
         onLoading: (what) => st.setLoading(what),
         onError: (why) => st.setError(why),
         onDrawn: () => drawn(v),
      })
      viewer = v
      const stop = reaction(
         () => {
            const view = st.shown
            if (view == null || view === 'source') return null
            return { space: SPACE[view], url: st.fileUrl(view), fov: st.info?.splatFov ?? undefined }
         },
         (src) => {
            if (src?.url == null) return
            void v.load({ space: src.space, url: src.url, fov: src.fov }).then(() => v.setCam(st.cam))
         },
         { fireImmediately: true, equals: compareStructural },
      )
      return () => {
         stop()
         v.destroy()
         if (viewer === v) viewer = null
      }
   }, [])
   return <div ref={host} className="view" />
})

const Stage = observer(function Stage() {
   const shown = st.shown
   const src = shown === 'source' ? st.fileUrl('source') : null
   useEffect(() => shotReady(shown === 'source'), [shown])
   return (
      <div className="stage">
         {shown != null && shown !== 'source' ? <Scene /> : null}
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
                  <button className="tab" title="R, or a double click" onClick={() => viewer?.reset()}>
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
