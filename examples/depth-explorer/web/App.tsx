import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GlView, type GlParams } from './gl.ts'
import { greyDepth, loadImage, paintDepth } from './pixels.ts'
import { RelightWidgetView } from '../../../src/cli/serve/web/widgets/RelightWidget.tsx'
import { widget, type RelightRoles } from '../../../src/vars/outputWidgets.ts'
import type { AppSt, ModelInfo } from './state.ts'

/** grey (optionally stretched) depth canvas per result url, shared by the card, the wipe and the 3D view */
const greyCache = new Map<string, Promise<HTMLCanvasElement>>()
function grey(url: string, stretch: boolean): Promise<HTMLCanvasElement> {
   const k = `${url}|${stretch}`
   let hit = greyCache.get(k)
   if (hit == null) {
      hit = loadImage(url).then((img) => greyDepth(img, stretch))
      greyCache.set(k, hit)
   }
   return hit
}

/** a depth result in the picked colormap, a material map in stretched grey, a normal map as is */
const MapImage = observer(function MapImage(p: { st: AppSt; model: ModelInfo; url: string; className?: string }) {
   const ref = useRef<HTMLCanvasElement>(null)
   const { colormap, autoLevels } = p.st
   useEffect(() => {
      if (p.model.kind === 'normal') return
      let live = true
      const material = p.model.kind === 'material'
      void grey(p.url, material || autoLevels).then((g) => {
         if (live && ref.current != null) paintDepth(g, material ? 'gray' : colormap, ref.current)
      })
      return () => {
         live = false
      }
   }, [p.url, colormap, autoLevels, p.model.kind])
   if (p.model.kind === 'normal')
      return <img className={p.className} src={p.url} alt={p.model.label} draggable={false} />
   return <canvas className={p.className} ref={ref} />
})

const Card = observer(function Card(p: { st: AppSt; model: ModelInfo }) {
   const { st, model } = p
   const r = st.result(model.id)
   const aspect = st.source != null ? `${st.source.width} / ${st.source.height}` : '1'
   let body: ReactNode
   if (!model.ok) {
      body = (
         <div className="missing">
            <b>not on this host</b>
            {model.missingNodes.length > 0 && <span>nodes: {model.missingNodes.join(', ')}</span>}
            {model.missingFiles.map((f) => (
               <a key={f.file} href={f.url} target="_blank" rel="noreferrer">
                  models/{f.folder}/{f.file}
               </a>
            ))}
         </div>
      )
   } else if (r == null) {
      body = (
         <button className="ghost" onClick={() => st.enqueue(model.id)} disabled={st.source == null}>
            run
         </button>
      )
   } else if (r.status === 'queued') body = <span className="dim">queued</span>
   else if (r.status === 'running')
      body = (
         <span className="dim">
            <span className="spin" /> {((st.now - r.startedAt) / 1000).toFixed(1)} s
            {model.autoDownload && st.now - r.startedAt > 8000 && <small>first run downloads the weights</small>}
         </span>
      )
   else if (r.status === 'error')
      body = (
         <div className="err">
            <span>{r.error}</span>
            <button className="ghost" onClick={() => st.enqueue(model.id)}>
               retry
            </button>
         </div>
      )
   else if (r.url != null) body = <MapImage st={st} model={model} url={r.url} />

   const done = r?.status === 'done'
   return (
      <div className={`card ${done ? 'done' : ''} ${model.ok ? '' : 'off'}`}>
         <div className="cardHead">
            <span className="name">
               {model.label} <span className="fam">{model.family}</span>
            </span>
            <span className="meta">
               {r?.ms != null && done ? `${(r.ms / 1000).toFixed(1)} s · ` : ''}
               {model.year}
            </span>
         </div>
         <div className="frame" style={{ aspectRatio: aspect }} onClick={() => done && st.openFocus(model.id)}>
            {body}
         </div>
         <div className="blurb">{model.blurb}</div>
      </div>
   )
})

const Section = observer(function Section(p: { st: AppSt; title: string; models: ModelInfo[] }) {
   if (p.models.length === 0) return null
   return (
      <section>
         <h2>{p.title}</h2>
         <div className="grid">
            {p.models.map((m) => (
               <Card key={m.id} st={p.st} model={m} />
            ))}
         </div>
      </section>
   )
})

function Seg<T extends string | number>(p: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
   return (
      <div className="seg">
         {p.options.map(([v, label]) => (
            <button key={String(v)} className={v === p.value ? 'on' : ''} onClick={() => p.onChange(v)}>
               {label}
            </button>
         ))}
      </div>
   )
}

const Sidebar = observer(function Sidebar(p: { st: AppSt }) {
   const { st } = p
   const [drag, setDrag] = useState(false)
   const fileRef = useRef<HTMLInputElement>(null)
   const take = (f: File | undefined): void => {
      if (f != null && f.type.startsWith('image/')) void st.setSource(f, f.name)
   }
   useEffect(() => {
      const onPaste = (e: ClipboardEvent): void => {
         const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'))
         take(f)
      }
      window.addEventListener('paste', onPaste)
      return () => window.removeEventListener('paste', onPaste)
   })
   return (
      <aside>
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
            {st.source != null ? <img src={st.source.url} alt={st.source.name} /> : <span>drop an image</span>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files?.[0])} />
         </div>
         <div className="dim small">
            {st.source != null ? `${st.source.name} · ${st.source.width}×${st.source.height}` : ''}
            <br />
            drop, click or paste an image
         </div>
         <div className="samples">
            {st.samples.map((s) => (
               <img key={s} src={`/api/samples/${s}`} alt={s} title={s} onClick={() => void st.loadSample(s)} />
            ))}
         </div>

         <label>detail</label>
         <Seg
            value={st.detail}
            options={[
               [512, '512'],
               [768, '768'],
               [1024, '1024'],
            ]}
            onChange={(v) => st.set('detail', v)}
         />
         <label>depth colors</label>
         <Seg
            value={st.colormap}
            options={[
               ['turbo', 'turbo'],
               ['gray', 'grey'],
            ]}
            onChange={(v) => st.set('colormap', v)}
         />
         <label className="check">
            <input type="checkbox" checked={st.autoLevels} onChange={(e) => st.set('autoLevels', e.target.checked)} />
            stretch each depth map (2 to 98 %)
         </label>
         <label className="check">
            <input type="checkbox" checked={st.showClassic} onChange={(e) => st.set('showClassic', e.target.checked)} />
            show classic baselines (2021 to 2023)
         </label>
         <label className="check">
            <input type="checkbox" checked={st.showMissing} onChange={(e) => st.set('showMissing', e.target.checked)} />
            show models this host lacks
         </label>
         <button
            className="primary"
            disabled={st.source == null || st.runnable.length === 0}
            onClick={() => st.runAll()}
         >
            {st.busy ? 'running…' : `run all ${st.runnable.length}`}
         </button>
         <div className="dim small">one prompt at a time on {st.host}; click a finished card to inspect it</div>
      </aside>
   )
})

const Wipe = observer(function Wipe(p: { st: AppSt; model: ModelInfo; url: string }) {
   const { st } = p
   const x = st.wipeX
   const against = st.wipeAgainst === 'source' ? null : st.model(st.wipeAgainst)
   const againstUrl = against != null ? st.result(against.id)?.url : null
   const src = st.source
   if (src == null) return null
   const move = (e: React.PointerEvent<HTMLDivElement>): void => {
      const r = e.currentTarget.getBoundingClientRect()
      st.set('wipeX', Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)))
   }
   return (
      <div
         className="wipe"
         style={{
            aspectRatio: `${src.width} / ${src.height}`,
            width: `min(100%, calc((100vh - 140px) * ${src.width / src.height}))`,
         }}
         onPointerMove={move}
      >
         {against != null && againstUrl != null ? (
            <MapImage st={st} model={against} url={againstUrl} className="layer" />
         ) : (
            <img className="layer" src={src.url} alt="source" draggable={false} />
         )}
         <div className="layer" style={{ clipPath: `inset(0 0 0 ${x}%)` }}>
            <MapImage st={st} model={p.model} url={p.url} className="layer" />
         </div>
         <div className="handle" style={{ left: `${x}%` }} />
         <span className="tag l">{against != null ? `${against.label} ${against.family}` : 'source'}</span>
         <span className="tag r">
            {p.model.label} {p.model.family}
         </span>
      </div>
   )
})

/** the depth map as a textured 3D relief: drag to orbit, wheel to zoom */
const ReliefPanel = observer(function ReliefPanel(p: { st: AppSt; url: string }) {
   const { st } = p
   const ref = useRef<HTMLCanvasElement>(null)
   const view = useRef<GlView | null>(null)
   const params: GlParams = st.relief
   const setParams = (v: GlParams): void => st.set('relief', v)
   const [error, setError] = useState<string | null>(null)
   const [ready, setReady] = useState(false)

   useEffect(() => {
      const c = ref.current
      const src = st.source
      if (c == null || src == null) return
      let live = true
      try {
         view.current ??= new GlView(c)
      } catch (e) {
         setError(e instanceof Error ? e.message : String(e))
         return
      }
      void Promise.all([loadImage(src.url), grey(p.url, st.autoLevels)]).then(([s, m]) => {
         if (!live) return
         view.current?.setImages(s, m, src.width / src.height)
         setReady(true)
      })
      return () => {
         live = false
      }
   }, [p.url, st.source, st.autoLevels])

   useEffect(() => {
      if (ready) view.current?.draw(params)
   })
   useEffect(() => {
      const onResize = (): void => view.current?.draw(params)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
   })

   const drag = useRef<{ x: number; y: number } | null>(null)
   const onMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
      const d = drag.current
      if (d == null) return
      setParams({
         ...params,
         yaw: params.yaw + (e.clientX - d.x) * 0.008,
         pitch: Math.min(1.4, Math.max(-1.4, params.pitch + (e.clientY - d.y) * 0.008)),
      })
      drag.current = { x: e.clientX, y: e.clientY }
   }

   if (error != null) return <div className="err">{error}</div>
   return (
      <div className="glWrap">
         <canvas
            ref={ref}
            className="gl"
            onPointerDown={(e) => {
               drag.current = { x: e.clientX, y: e.clientY }
               e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerMove={onMove}
            onWheel={(e) =>
               setParams({ ...params, zoom: Math.min(3, Math.max(0.3, params.zoom * (e.deltaY > 0 ? 1.08 : 0.93))) })
            }
         />
         <div className="glControls">
            <label>
               depth
               <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={params.depthScale}
                  onChange={(e) => setParams({ ...params, depthScale: Number(e.target.value) })}
               />
            </label>
            <label>
               shading
               <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={params.shade}
                  onChange={(e) => setParams({ ...params, shade: Number(e.target.value) })}
               />
            </label>
            <span className="dim">drag to orbit · wheel to zoom</span>
         </div>
      </div>
   )
})

/** the panel's relight widget, fed with the focus and the best finished maps of the grid */
const RelightPanel = observer(function RelightPanel(p: { st: AppSt }) {
   const maps = p.st.relightMaps
   const roles: RelightRoles = { image: 'source' }
   for (const m of maps) if (m.tag !== 'source') Object.assign(roles, { [m.tag]: m.tag })
   if (roles.depth == null && roles.normal == null)
      return <div className="err">run a depth or a normal model first</div>
   const images = maps.map((m) => ({ filename: m.tag, url: m.url, absPath: null, tags: [m.tag] }))
   return (
      <div className="relightWrap">
         <RelightWidgetView key={maps.map((m) => m.url).join('|')} widget={widget.relight(roles)} images={images} />
         <div className="dim small">
            maps: {maps.map((m) => m.tag).join(' · ')}. Run more models in the grid to add a map (albedo, roughness and
            metalness come from the materials section).
         </div>
      </div>
   )
})

const Focus = observer(function Focus(p: { st: AppSt }) {
   const { st } = p
   const model = st.focus != null ? st.model(st.focus) : undefined
   const r = model != null ? st.result(model.id) : undefined
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Escape') st.closeFocus()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [st])
   if (model == null || r?.url == null) return null
   const others = st.doneModels.filter((m) => m.id !== model.id)
   return (
      <div className="focus" onClick={(e) => e.target === e.currentTarget && st.closeFocus()}>
         <div className="focusBox">
            <div className="focusBar">
               <b>
                  {model.label} <span className="fam">{model.family}</span>
               </b>
               <Seg
                  value={st.focusView}
                  options={
                     model.kind === 'depth'
                        ? [
                             ['wipe', 'compare'],
                             ['3d', '3D relief'],
                             ['light', 'relight'],
                          ]
                        : model.kind === 'normal'
                          ? [
                               ['wipe', 'compare'],
                               ['light', 'relight'],
                            ]
                          : [['wipe', 'compare']]
                  }
                  onChange={(v) => st.set('focusView', v)}
               />
               {st.focusView === 'wipe' && (
                  <select value={st.wipeAgainst} onChange={(e) => st.set('wipeAgainst', e.target.value)}>
                     <option value="source">against the source</option>
                     {others.map((m) => (
                        <option key={m.id} value={m.id}>
                           against {m.label} {m.family}
                        </option>
                     ))}
                  </select>
               )}
               <a className="ghost" href={r.url} download={`${st.source?.name ?? 'image'}.${model.id}.png`}>
                  download
               </a>
               <button className="ghost" onClick={() => st.closeFocus()}>
                  close
               </button>
            </div>
            {st.focusView === 'wipe' ? (
               <Wipe st={st} model={model} url={r.url} />
            ) : st.focusView === '3d' ? (
               <ReliefPanel key={model.id} st={st} url={r.url} />
            ) : (
               <RelightPanel st={st} />
            )}
         </div>
      </div>
   )
})

export const App = observer(function App(p: { st: AppSt }) {
   const { st } = p
   return (
      <div className="app">
         <header>
            <h1>depth explorer</h1>
            <span className="dim">every depth, normal and material estimator on {st.host || '…'}, one image</span>
         </header>
         {st.loadError != null && <div className="err">server: {st.loadError}</div>}
         <div className="body">
            <Sidebar st={st} />
            <main>
               <Section st={st} title="depth" models={st.depthModels} />
               <Section st={st} title="normals" models={st.normalModels} />
               <Section st={st} title="materials" models={st.materialModels} />
            </main>
         </div>
         <Focus st={st} />
      </div>
   )
})
