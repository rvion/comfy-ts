// the relight widget: the photo lit again by a point light you move over it. Drag = left/right,
// up/down; wheel = nearer/farther; the bar holds colour, power, shadows, orbit, motes and the map
// views. `window.relightAt(t)` draws instant t (sk shot --step), `window.relightTour(t)` the
// scripted tour a demo video steps through.
import { observer } from 'mobx-react-lite'
import { autorun } from 'mobx'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeneratedImage } from 'src/cli/serve/web/api.ts'
import { RelightGl, type RelightMaps, type RelightView } from 'src/cli/serve/web/widgets/relightGl.ts'
import { RelightSt } from 'src/cli/serve/web/widgets/RelightSt.ts'
import { resolveWidgetRoles, type RelightRoles, type RelightWidget } from 'src/vars/outputWidgets.ts'

const ROLE_KEYS: (keyof RelightRoles)[] = ['image', 'depth', 'normal', 'albedo', 'roughness', 'metalness', 'specular']

function loadImage(url: string): Promise<HTMLImageElement> {
   const img = new Image()
   img.src = url
   return img.decode().then(() => img)
}

/** the scripted tour of a demo video: orbit, then motes, then the light comes close */
function tour(st: RelightSt, t: number): void {
   st.set('orbit', t < 9)
   st.set('particles', t >= 4)
   st.set('lightZ', t < 9 ? 0.4 : Math.max(0.06, 0.4 - (t - 9) * 0.09))
   if (t >= 9) {
      const k = (t - 9) / 4
      st.set('lightX', 0.15 + 0.7 * Math.min(1, k))
      st.set('lightY', 0.4 + 0.1 * Math.sin(k * 3))
   }
   st.at(t)
}

const VIEWS: [RelightView, string, keyof RelightRoles | null][] = [
   ['lit', 'lit', null],
   ['albedo', 'albedo', 'albedo'],
   ['normal', 'normals', null],
   ['depth', 'depth', 'depth'],
   ['roughness', 'roughness', 'roughness'],
   ['metalness', 'metalness', 'metalness'],
   ['specular', 'specular', 'specular'],
   ['shadow', 'shadows', 'depth'],
]

function Slider(p: {
   label: string
   min: number
   max: number
   step: number
   value: number
   onChange: (v: number) => void
}) {
   return (
      <label className="relight-slider">
         <span>{p.label}</span>
         <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={p.value}
            onChange={(e) => p.onChange(Number(e.target.value))}
         />
      </label>
   )
}

function Toggle(p: { label: string; on: boolean; onChange: (v: boolean) => void; tip: string }) {
   return (
      <button type="button" className={p.on ? 'seg on' : 'seg'} data-tip={p.tip} onClick={() => p.onChange(!p.on)}>
         {p.label}
      </button>
   )
}

export const RelightWidgetView = observer(function RelightWidgetView(p: {
   widget: RelightWidget
   images: GeneratedImage[]
}) {
   const st = useMemo(() => new RelightSt(), [])
   const canvasRef = useRef<HTMLCanvasElement>(null)
   const glRef = useRef<RelightGl | null>(null)
   const [error, setError] = useState<string | null>(null)
   const [aspect, setAspect] = useState(1)
   const [present, setPresent] = useState<Set<keyof RelightRoles>>(new Set())

   const roles = resolveWidgetRoles(p.widget, p.images)
   const urlOf = (role: keyof RelightRoles): string | null => {
      const ix = roles.get(role)
      return ix == null ? null : (p.images[ix]?.url ?? null)
   }
   const urlKey = ROLE_KEYS.map((r) => urlOf(r) ?? '').join('|')

   // load the maps whenever the run's urls change
   useEffect(() => {
      const canvas = canvasRef.current
      const imageUrl = urlOf('image')
      if (canvas == null || imageUrl == null) return
      let live = true
      try {
         glRef.current ??= new RelightGl(canvas)
      } catch (e) {
         setError(e instanceof Error ? e.message : String(e))
         return
      }
      const loads = ROLE_KEYS.map((role) => {
         const url = urlOf(role)
         return url == null ? Promise.resolve(null) : loadImage(url).then((img) => [role, img] as const)
      })
      void Promise.all(loads).then((pairs) => {
         if (!live) return
         const maps: RelightMaps = { image: new Image() }
         const got = new Set<keyof RelightRoles>()
         let w = 1
         let h = 1
         for (const pair of pairs) {
            if (pair == null) continue
            const [role, img] = pair
            maps[role] = img
            got.add(role)
            if (role === 'image') {
               w = img.naturalWidth
               h = img.naturalHeight
            }
         }
         setAspect(w / Math.max(1, h))
         setPresent(got)
         glRef.current?.setMaps(maps, w / Math.max(1, h), w, h)
         glRef.current?.draw(st.params)
      })
      return () => {
         live = false
      }
   }, [urlKey])

   // redraw on every parameter change; animate while the orbit or the motes run
   useEffect(() => {
      const stopDraw = autorun(() => glRef.current?.draw(st.params))
      let raf = 0
      let last = performance.now()
      const loop = (now: number): void => {
         if (st.animating) st.tick((now - last) / 1000)
         last = now
         raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      const onResize = (): void => glRef.current?.draw(st.params)
      window.addEventListener('resize', onResize)
      Object.assign(window, {
         relightAt: (t: number) => {
            st.at(t)
            glRef.current?.draw(st.params)
         },
         relightTour: (t: number) => {
            tour(st, t)
            glRef.current?.draw(st.params)
         },
         relight: st,
      })
      return () => {
         stopDraw()
         cancelAnimationFrame(raf)
         window.removeEventListener('resize', onResize)
      }
   }, [st])

   const dragging = useRef(false)
   const pointAt = (e: React.PointerEvent<HTMLCanvasElement>): void => {
      const r = e.currentTarget.getBoundingClientRect()
      st.moveLight((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
   }

   if (urlOf('image') == null)
      return <div className="relight-missing">relight: no output carries the `{p.widget.roles.image}` tag</div>
   if (error != null) return <div className="relight-missing">{error}</div>
   return (
      <div className="relight">
         <div className="relight-stage">
            <canvas
               ref={canvasRef}
               className="relight-canvas"
               style={{ aspectRatio: String(aspect) }}
               onPointerDown={(e) => {
                  dragging.current = true
                  e.currentTarget.setPointerCapture(e.pointerId)
                  pointAt(e)
               }}
               onPointerMove={(e) => {
                  if (dragging.current) pointAt(e)
               }}
               onPointerUp={() => (dragging.current = false)}
               onWheel={(e) => st.nudgeHeight(e.deltaY)}
            />
         </div>
         <div className="relight-bar">
            <div className="relight-row">
               <span className="relight-title">{p.widget.title ?? 'relight'}</span>
               <div className="relight-segs">
                  {VIEWS.filter(([, , need]) => need == null || present.has(need)).map(([view, label]) => (
                     <button
                        key={view}
                        type="button"
                        className={st.view === view ? 'seg on' : 'seg'}
                        onClick={() => st.set('view', view)}
                     >
                        {label}
                     </button>
                  ))}
               </div>
            </div>
            <div className="relight-row">
               <label className="relight-color" data-tip="light colour">
                  <input type="color" value={st.color} onChange={(e) => st.set('color', e.target.value)} />
               </label>
               <Slider
                  label="power"
                  min={0}
                  max={8}
                  step={0.05}
                  value={st.intensity}
                  onChange={(v) => st.set('intensity', v)}
               />
               <Slider
                  label="height"
                  min={0.02}
                  max={1.5}
                  step={0.01}
                  value={st.lightZ}
                  onChange={(v) => st.set('lightZ', v)}
               />
               <Slider
                  label="reach"
                  min={0.05}
                  max={3}
                  step={0.01}
                  value={st.falloff}
                  onChange={(v) => st.set('falloff', v)}
               />
               <Slider
                  label="photo"
                  min={0}
                  max={1}
                  step={0.01}
                  value={st.ambient}
                  onChange={(v) => st.set('ambient', v)}
               />
               <Slider
                  label="relief"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={st.depthScale}
                  onChange={(v) => st.set('depthScale', v)}
               />
            </div>
            <div className="relight-row">
               <Toggle
                  label="shadows"
                  on={st.shadows}
                  onChange={(v) => st.set('shadows', v)}
                  tip="cast through the depth map"
               />
               <Toggle
                  label="orbit"
                  on={st.orbit}
                  onChange={(v) => st.set('orbit', v)}
                  tip="the light circles the image"
               />
               <Toggle
                  label="motes"
                  on={st.particles}
                  onChange={(v) => st.set('particles', v)}
                  tip="small drifting lights"
               />
               {st.particles && (
                  <Slider
                     label="count"
                     min={1}
                     max={16}
                     step={1}
                     value={st.moteCount}
                     onChange={(v) => st.set('moteCount', v)}
                  />
               )}
               <Toggle
                  label="glow"
                  on={st.showLights}
                  onChange={(v) => st.set('showLights', v)}
                  tip="draw the lights themselves"
               />
               <span className="relight-hint">drag: move the light · wheel: nearer / farther</span>
            </div>
         </div>
      </div>
   )
})
