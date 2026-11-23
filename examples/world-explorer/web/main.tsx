import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { frameClient } from 'rvlib-shipkit/src/pages/frame-client.ts'
import { WorldSt, type View } from './state.ts'
import { Viewer } from './viewer.ts'

// one world of .comfy-ts/worlds, the view page of the `world` thread kind (agent/examples.md, world-explorer). Framed by
// the hub or alone at its url: the frame client hands it its keys either way

const LABEL: Record<View, string> = { pano: '360°', world: 'walk', splat: 'splat', source: 'picture' }
const HINT: Record<View, string> = {
   pano: 'drag to look, wheel to zoom',
   world: 'drag to look, WASD or arrows to walk',
   splat: 'drag to orbit, wheel to zoom',
   source: '',
}

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
      viewer = new Viewer(st, host.current, () => shotReady(true))
      return () => viewer?.stop()
   }, [])
   const shown = st.shown
   const src = shown === 'source' ? st.fileUrl('source') : null
   useEffect(() => shotReady(shown === 'source'), [shown])
   return (
      <div ref={host} className="stage">
         {src != null ? <img src={src} alt={st.name} draggable={false} /> : null}
         {st.error != null ? (
            <div className="note">{st.error}</div>
         ) : st.loading != null ? (
            <div className="note">loading {st.loading}…</div>
         ) : null}
         {st.name === '' && st.standalone ? <Worlds /> : null}
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
   return (
      <div className="app">
         <div className="bar">
            {st.views.map((v) => (
               <button key={v} className={`tab${v === shown ? ' on' : ''}`} onClick={() => st.setView(v)}>
                  {LABEL[v]}
               </button>
            ))}
            <span className="line">
               <b>{st.name || 'worlds'}</b>
               {st.side ? ` · ${st.side}` : ''}
               {shown != null && HINT[shown] ? ` · ${HINT[shown]}` : ''}
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
