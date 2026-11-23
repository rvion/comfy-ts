import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { RunBody, Seg, SourcePicker, timeOf } from '../../explorer-kit/web/ui.tsx'
import { Pair } from './compare.tsx'
import type { AppSt, ModelInfo } from './state.ts'
import { Layer, Viewport, ZoomBar } from './viewport.tsx'

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`

const Card = observer(function Card(p: { st: AppSt; model: ModelInfo }) {
   const { st, model } = p
   const r = st.result(model.id)
   const done = r?.status === 'done'
   const thumb = st.thumb(model.id)
   const aspect = st.source != null ? `${st.source.width} / ${st.source.height}` : '1'
   return (
      <div className={`card ${done ? 'done' : ''} ${model.ok ? '' : 'off'}`}>
         <div className="cardHead">
            <span className="name">
               {model.label} <span className="fam">{model.family}</span>
            </span>
            <span className="meta">{done ? timeOf(r) : model.date}</span>
         </div>
         <div
            className="frame"
            style={{ aspectRatio: aspect }}
            title={done ? 'click: compare at 100 % where you clicked' : undefined}
            onClick={(e) => {
               if (!done) return
               const b = e.currentTarget.getBoundingClientRect()
               st.openPair(model.id, undefined, false, { u: (e.clientX - b.left) / b.width, v: (e.clientY - b.top) / b.height })
            }}
         >
            {done && thumb != null ? (
               <img src={thumb} alt={model.label} draggable={false} />
            ) : done ? (
               <span className="dim">…</span>
            ) : (
               <RunBody model={model} run={r} now={st.runs.now} canRun={st.source != null} onRun={() => st.enqueue(model.id)} />
            )}
         </div>
         <div className="facts">
            <span className="chip">{model.arch}</span>
            {model.native > 0 && <span className="chip">×{model.native} native</span>}
            {done && <span className="chip out">{`${r.width}×${r.height} · ${mb(r.bytes)}`}</span>}
         </div>
         <div className="blurb">
            {model.blurb}
            {model.kind !== 'baseline' && <span className="dim"> · {model.size} · {model.license}</span>}
         </div>
      </div>
   )
})

const Grid = observer(function Grid(p: { st: AppSt }) {
   const { st } = p
   const groups: [string, ModelInfo[]][] = [
      ['models', st.visibleModels.filter((m) => m.kind === 'baseline' || (m.kind === 'model' && m.tier === 'modern'))],
      ['diffusion', st.visibleModels.filter((m) => m.kind === 'diffusion')],
      ['classic models (2018 to 2022)', st.visibleModels.filter((m) => m.kind === 'model' && m.tier === 'classic')],
   ]
   return (
      <>
         {groups.map(([title, models]) =>
            models.length === 0 ? null : (
               <section key={title}>
                  <h2>{title}</h2>
                  <div className="grid">
                     {models.map((m) => (
                        <Card key={m.id} st={st} model={m} />
                     ))}
                  </div>
               </section>
            ),
         )}
      </>
   )
})

/** every finished result on the same crop, at the same zoom: the place to judge text and symbols */
const Loupe = observer(function Loupe(p: { st: AppSt }) {
   const { st } = p
   if (st.done.length === 0) return <div className="dim">run some models first: the loupe shows the finished ones</div>
   return (
      <div className="loupe" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${st.tile}px, 1fr))` }}>
         {st.done.map((m) => {
            const r = st.result(m.id)
            if (r?.url == null) return null
            return (
               <div key={m.id} className="tile">
                  <div className="tileHead" title="compare it with another" onClick={() => st.openPair(m.id)}>
                     <span className="name">
                        {m.label} <span className="fam">{m.family}</span>
                     </span>
                     <span className="meta">{timeOf(r)}</span>
                  </div>
                  <Viewport st={st} className="tileView">
                     {(box) => <Layer url={r.url ?? ''} box={box} alt={m.label} />}
                  </Viewport>
               </div>
            )
         })}
      </div>
   )
})

/** the source with the loupe's crop on it: click or drag to move the crop */
const Navigator = observer(function Navigator(p: { st: AppSt }) {
   const { st } = p
   const src = st.source
   const drag = useRef(false)
   if (src == null) return null
   const s = st.zoomIn(st.frame.w, st.frame.h) / devicePixelRatio
   const fw = st.outW * s > 0 ? Math.min(1, st.frame.w / (st.outW * s)) : 1
   const fh = st.outH * s > 0 ? Math.min(1, st.frame.h / (st.outH * s)) : 1
   const cx = st.view.z === 'fit' ? 0.5 : st.view.cx
   const cy = st.view.z === 'fit' ? 0.5 : st.view.cy
   const go = (e: React.PointerEvent<HTMLDivElement>): void => {
      const b = e.currentTarget.getBoundingClientRect()
      st.setView({ cx: (e.clientX - b.left) / b.width, cy: (e.clientY - b.top) / b.height, z: st.zoomIn(st.frame.w, st.frame.h) })
   }
   return (
      <div
         className="nav"
         style={{ aspectRatio: `${src.width} / ${src.height}` }}
         onPointerDown={(e) => {
            drag.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            go(e)
         }}
         onPointerMove={(e) => drag.current && go(e)}
         onPointerUp={() => (drag.current = false)}
      >
         <img src={src.url} alt="" draggable={false} />
         <div
            className="navBox"
            style={{ left: `${(cx - fw / 2) * 100}%`, top: `${(cy - fh / 2) * 100}%`, width: `${fw * 100}%`, height: `${fh * 100}%` }}
         />
      </div>
   )
})

const Sidebar = observer(function Sidebar(p: { st: AppSt }) {
   const { st } = p
   return (
      <aside>
         {st.layout === 'loupe' && (
            <>
               <label className="first">the loupe's crop: click or drag</label>
               <Navigator st={st} />
            </>
         )}
         <SourcePicker
            source={st.source}
            samples={st.samples}
            onFile={(f, name) => void st.setSource(f, name)}
            onSample={(name) => void st.loadSample(name)}
         />
         <label>scale</label>
         <Seg
            value={st.scale}
            options={[
               [2, '×2'],
               [4, '×4'],
            ]}
            tips={['twice the source: about 600 dpi at card size for a 744 px wide scan', 'four times the source: about 1200 dpi']}
            onChange={(v) => st.set('scale', v)}
         />
         <div className="dim small">
            {st.source != null ? `every result is ${st.outW}×${st.outH}: a model of another factor is brought to it with Lanczos` : ''}
         </div>
         <label className="check">
            <input type="checkbox" checked={st.showClassic} onChange={(e) => st.set('showClassic', e.target.checked)} />
            show classic models (2018 to 2022)
         </label>
         <label className="check">
            <input type="checkbox" checked={st.showMissing} onChange={(e) => st.set('showMissing', e.target.checked)} />
            show models this host lacks
         </label>
         <button className="primary" disabled={st.source == null || st.runnable.length === 0} onClick={() => st.runAll()}>
            {st.busy ? 'running…' : `run all ${st.runnable.length}`}
         </button>
         <div className="dim small">one prompt at a time on {st.host}</div>
      </aside>
   )
})

export const App = observer(function App(p: { st: AppSt }) {
   const { st } = p
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         const t = e.target
         if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return
         if (e.key === 'Escape') st.closePair()
         else if ((e.key === 'd' || e.key === 'D') && st.after != null) st.cycleMode(e.shiftKey ? -1 : 1)
         else if (e.key === '+' || e.key === '=') st.step(1.5)
         else if (e.key === '-' || e.key === '_') st.step(1 / 1.5)
         else if (e.key === '0') st.fit()
         else if (e.key === '1') st.actual()
         else return
         e.preventDefault()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [st])
   return (
      <div className="app">
         <header>
            <h1>upscale explorer</h1>
            <span className="dim">every upscaler on {st.host || '…'}, one image, judged at 100 % pixels</span>
         </header>
         {st.loadError != null && <div className="err">server: {st.loadError}</div>}
         <div className="body">
            <Sidebar st={st} />
            <main>
               <div className="toolbar">
                  <Seg
                     value={st.layout}
                     options={[
                        ['grid', 'grid'],
                        ['loupe', 'loupe'],
                     ]}
                     tips={['every model, whole', 'every finished model on the same crop at the same zoom']}
                     onChange={(v) => st.set('layout', v)}
                  />
                  {st.layout === 'loupe' && (
                     <>
                        <ZoomBar st={st} />
                        <Seg
                           value={st.tile}
                           options={[
                              [260, 'S'],
                              [360, 'M'],
                              [520, 'L'],
                           ]}
                           tips={['small tiles', 'medium tiles', 'large tiles']}
                           onChange={(v) => st.set('tile', v)}
                        />
                        <span className="dim small">wheel: zoom · drag: pan, every tile follows · click a name to compare</span>
                     </>
                  )}
                  {st.layout === 'grid' && <span className="dim small">click a result: compare it with Lanczos at 100 % where you clicked</span>}
               </div>
               {st.layout === 'grid' ? <Grid st={st} /> : <Loupe st={st} />}
            </main>
         </div>
         <Pair st={st} />
      </div>
   )
})
