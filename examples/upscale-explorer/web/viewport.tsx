// a frame on the shared view: every picture inside it is drawn at the results' pixel size, placed by
// the view's centre and zoom, so every frame of the page shows the same crop. The wheel or a pinch
// zooms around the pointer, a drag pans, a double click goes from the whole image to 100 % where it
// landed and back.
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppSt } from './state.ts'

/** where the image sits in its frame, css px, and its zoom (device pixels per image pixel) */
export type Box = { left: number; top: number; width: number; height: number; z: number }

/** a picture at the results' pixel size, placed on the box; pixels stay square above 100 % */
export function Layer(p: { url: string; box: Box; style?: React.CSSProperties; alt?: string }) {
   return (
      <img
         className={`layer ${p.box.z > 1.01 ? 'px' : ''}`}
         src={p.url}
         alt={p.alt ?? ''}
         draggable={false}
         style={{ left: p.box.left, top: p.box.top, width: p.box.width, height: p.box.height, ...p.style }}
      />
   )
}

export const Viewport = observer(function Viewport(p: {
   st: AppSt
   className?: string
   /** a press the caller takes instead of a pan (the curtain's line): true = taken */
   onPress?: (e: React.PointerEvent<HTMLDivElement>, frame: DOMRect) => boolean
   onHover?: (inside: boolean) => void
   children: (box: Box) => ReactNode
}) {
   const { st } = p
   const ref = useRef<HTMLDivElement>(null)
   const [size, setSize] = useState({ w: 0, h: 0 })
   const drag = useRef<{ x: number; y: number } | null>(null)

   useEffect(() => {
      const el = ref.current
      if (el == null) return
      const ro = new ResizeObserver(() => {
         setSize({ w: el.clientWidth, h: el.clientHeight })
         st.noteFrame(el.clientWidth, el.clientHeight)
      })
      ro.observe(el)
      // non passive, so the page never scrolls under a zoom; a pinch arrives as a wheel with ctrlKey
      const onWheel = (e: WheelEvent): void => {
         e.preventDefault()
         const r = el.getBoundingClientRect()
         const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
         st.zoomAt(k, e.clientX - r.left, e.clientY - r.top, r.width, r.height)
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => {
         ro.disconnect()
         el.removeEventListener('wheel', onWheel)
      }
   }, [st])

   const z = st.zoomIn(size.w, size.h)
   const s = z / devicePixelRatio
   const fit = st.view.z === 'fit'
   const cx = fit ? 0.5 : st.view.cx
   const cy = fit ? 0.5 : st.view.cy
   const box: Box = {
      width: st.outW * s,
      height: st.outH * s,
      left: size.w / 2 - cx * st.outW * s,
      top: size.h / 2 - cy * st.outH * s,
      z,
   }
   return (
      <div
         ref={ref}
         className={`viewport ${p.className ?? ''}`}
         onPointerDown={(e) => {
            if (!e.isPrimary || e.button !== 0) return
            const el = ref.current
            if (el == null) return
            if (p.onPress?.(e, el.getBoundingClientRect()) === true) return
            drag.current = { x: e.clientX, y: e.clientY }
            el.setPointerCapture(e.pointerId)
         }}
         onPointerMove={(e) => {
            const d = drag.current
            if (d == null) return
            st.pan(e.clientX - d.x, e.clientY - d.y, size.w, size.h)
            drag.current = { x: e.clientX, y: e.clientY }
         }}
         onPointerUp={() => (drag.current = null)}
         onPointerCancel={() => (drag.current = null)}
         onDoubleClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            if (z > 0.99 && !fit) return st.fit()
            const u = (e.clientX - r.left - box.left) / box.width
            const v = (e.clientY - r.top - box.top) / box.height
            st.setView({ cx: u, cy: v, z: 1 })
         }}
         onMouseEnter={() => p.onHover?.(true)}
         onMouseLeave={() => p.onHover?.(false)}
      >
         {st.outW > 0 && size.w > 0 ? p.children(box) : null}
      </div>
   )
})

/** the zoom as a percent of real pixels, and the buttons that set it */
export const ZoomBar = observer(function ZoomBar(p: { st: AppSt }) {
   const { st } = p
   const z = st.view.z
   return (
      <span className="zoombar">
         <button title="zoom out (−)" onClick={() => st.step(1 / 1.5)}>
            −
         </button>
         <span className="zoompct" title="device pixels per result pixel">
            {z === 'fit' ? 'fit' : `${Math.round(z * 100)} %`}
         </span>
         <button title="zoom in (+)" onClick={() => st.step(1.5)}>
            +
         </button>
         <button className={z === 'fit' ? 'on' : ''} title="the whole image (0)" onClick={() => st.fit()}>
            fit
         </button>
         <button className={z === 1 ? 'on' : ''} title="100 %: one result pixel on one screen pixel (1)" onClick={() => st.actual()}>
            1:1
         </button>
      </span>
   )
})
