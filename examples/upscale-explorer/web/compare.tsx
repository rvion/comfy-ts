// a pair of results, compared the way the hub's threads compare a before and an after (shipkit
// review-views.tsx): side by side, a curtain, an onion skin, the after alone with the before under
// the pointer, or only the pixels that changed. Every mode draws on the shared view, so a zoom on
// one side is the zoom on both.
import { observer } from 'mobx-react-lite'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { timeOf } from '../../explorer-kit/web/ui.tsx'
import { COMPARE_MODES, type AppSt, type CompareMode } from './state.ts'
import { Layer, Viewport, ZoomBar, type Box } from './viewport.tsx'

const MODES: { mode: CompareMode; glyph: string; tip: string }[] = [
   { mode: 'side', glyph: '◫', tip: 'side by side' },
   { mode: 'swipe', glyph: '⇹', tip: 'curtain: drag the line, the before on the left, the after on the right' },
   { mode: 'onion', glyph: '◐', tip: 'onion skin: the after over the before' },
   { mode: 'mod', glyph: '▣', tip: 'the after alone: hovering the image shows the before' },
   { mode: 'diff', glyph: '≠', tip: "only what changed: the after's changed pixels in colour, the rest faded" },
]

/** a sum of channel differences under this is noise, as in the hub */
const DIFF_NOISE = 24

const changesWords = (share: number | null | undefined): string =>
   share === undefined
      ? 'reading…'
      : share === null
        ? 'could not be read'
        : share === 0
          ? 'none: no pixel differs'
          : `${share < 0.001 ? '< 0.1' : (share * 100).toFixed(1)} % of the pixels`

type Diff = { canvas: HTMLCanvasElement; share: number }
const diffCache = new Map<string, Promise<Diff | null>>()

/** the after where it differs from the before, each changed pixel in its own colour and every other
 * one a pale grey of it, at the results' size (the before is drawn at that size too) */
function diffOf(before: string, after: string, w: number, h: number): Promise<Diff | null> {
   const key = `${before}|${after}`
   let hit = diffCache.get(key)
   if (hit == null) {
      hit = (async (): Promise<Diff | null> => {
         try {
            const load = async (url: string): Promise<ImageBitmap> => createImageBitmap(await (await fetch(url)).blob())
            const [a, b] = await Promise.all([load(before), load(after)])
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            if (ctx == null) return null
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(a, 0, 0, w, h)
            const pa = ctx.getImageData(0, 0, w, h).data
            ctx.clearRect(0, 0, w, h)
            ctx.drawImage(b, 0, 0, w, h)
            const out = ctx.getImageData(0, 0, w, h)
            const pb = out.data
            let changed = 0
            for (let i = 0; i < pb.length; i += 4) {
               const d =
                  Math.abs((pa[i] ?? 0) - (pb[i] ?? 0)) +
                  Math.abs((pa[i + 1] ?? 0) - (pb[i + 1] ?? 0)) +
                  Math.abs((pa[i + 2] ?? 0) - (pb[i + 2] ?? 0))
               if (d > DIFF_NOISE) {
                  changed++
                  continue
               }
               const v = 228 + ((pb[i] ?? 0) * 0.3 + (pb[i + 1] ?? 0) * 0.59 + (pb[i + 2] ?? 0) * 0.11) * 0.1
               pb[i] = v
               pb[i + 1] = v
               pb[i + 2] = v
            }
            ctx.putImageData(out, 0, 0)
            return { canvas, share: changed / (w * h) }
         } catch (e) {
            console.error('🔴 diff failed:', e)
            return null
         }
      })()
      diffCache.set(key, hit)
   }
   return hit
}

/** the diff canvas on the box: one canvas per pair, mounted where the view puts it */
function DiffLayer(p: { diff: Diff; box: Box }) {
   const ref = useRef<HTMLDivElement>(null)
   useLayoutEffect(() => {
      const el = ref.current
      if (el == null) return
      const c = p.diff.canvas
      if (c.parentElement !== el) el.replaceChildren(c)
      c.className = `layer ${p.box.z > 1.01 ? 'px' : ''}`
      Object.assign(c.style, {
         left: `${p.box.left}px`,
         top: `${p.box.top}px`,
         width: `${p.box.width}px`,
         height: `${p.box.height}px`,
      })
   })
   return <div ref={ref} className="fill" />
}

const Tag = (p: { side: 'before' | 'after'; name: string }) => <span className={`sidetag ${p.side}`}>{p.name}</span>

const Stage = observer(function Stage(p: { st: AppSt; before: string; after: string }) {
   const { st } = p
   const [peek, setPeek] = useState(false)
   const [diff, setDiff] = useState<Diff | null | undefined>(undefined)
   const bName = st.nameOf(st.before)
   const aName = st.after != null ? st.nameOf(st.after) : ''

   useEffect(() => {
      if (st.mode !== 'diff') return
      let live = true
      setDiff(undefined)
      void diffOf(p.before, p.after, st.outW, st.outH).then((d) => live && setDiff(d))
      return () => {
         live = false
      }
   }, [st.mode, p.before, p.after, st.outW, st.outH])

   if (st.mode === 'side')
      return (
         <div className="stage side">
            <div className="cell">
               <Viewport st={st} className="side-before">
                  {(box) => <Layer url={p.before} box={box} alt={bName} />}
               </Viewport>
               <Tag side="before" name={bName} />
            </div>
            <div className="cell">
               <Viewport st={st} className="side-after">
                  {(box) => <Layer url={p.after} box={box} alt={aName} />}
               </Viewport>
               <Tag side="after" name={aName} />
            </div>
         </div>
      )
   if (st.mode === 'diff')
      return (
         <div className="stage">
            <div className="cell">
               <Viewport st={st}>{(box) => (diff != null ? <DiffLayer diff={diff} box={box} /> : null)}</Viewport>
               <Tag side="after" name={aName} />
            </div>
            <div className="caption">
               changes view: only the changed pixels are coloured, <b>{changesWords(diff === undefined ? undefined : (diff?.share ?? null))}</b> · ◫ or D for the normal view
            </div>
         </div>
      )
   if (st.mode === 'mod')
      return (
         <div className="stage">
            <div className="cell">
               <Viewport st={st} className={peek ? 'side-before' : 'side-after'} onHover={setPeek}>
                  {(box) => <Layer url={peek ? p.before : p.after} box={box} />}
               </Viewport>
               <Tag side={peek ? 'before' : 'after'} name={peek ? bName : aName} />
            </div>
            <div className="caption">the after alone; the pointer over the image shows the before</div>
         </div>
      )
   const pct = st.split * 100
   // the curtain: a press within 12 px of the line drags the line, anywhere else pans
   const press = (e: React.PointerEvent<HTMLDivElement>, frame: DOMRect): boolean => {
      if (st.mode !== 'swipe' || Math.abs(e.clientX - frame.left - st.split * frame.width) > 12) return false
      e.preventDefault()
      const move = (m: PointerEvent): void => st.set('split', Math.min(1, Math.max(0, (m.clientX - frame.left) / frame.width)))
      const up = (): void => {
         window.removeEventListener('pointermove', move)
         window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return true
   }
   return (
      <div className="stage">
         <div className="cell">
            <Viewport st={st} onPress={press}>
               {(box) => (
                  <>
                     <div className="fill" style={st.mode === 'swipe' ? { clipPath: `inset(0 ${100 - pct}% 0 0)` } : undefined}>
                        <Layer url={p.before} box={box} />
                     </div>
                     <div
                        className="fill"
                        style={st.mode === 'swipe' ? { clipPath: `inset(0 0 0 ${pct}%)` } : { opacity: st.opacity }}
                     >
                        <Layer url={p.after} box={box} />
                     </div>
                     {st.mode === 'swipe' && <div className="curtain" style={{ left: `${pct}%` }} />}
                  </>
               )}
            </Viewport>
            {st.mode === 'swipe' ? (
               <>
                  <span className="sidetag before left">{bName}</span>
                  <span className="sidetag after">{aName}</span>
               </>
            ) : (
               <Tag side="after" name={`${aName} over ${bName}`} />
            )}
         </div>
         <div className="caption">
            {st.mode === 'swipe' ? 'curtain: drag the line; a drag anywhere else pans' : `onion skin: the after at ${Math.round(st.opacity * 100)} %`}
         </div>
      </div>
   )
})

/** the pair view over the page: pick the two sides, the mode, the zoom */
export const Pair = observer(function Pair(p: { st: AppSt }) {
   const { st } = p
   const after = st.after
   if (after == null) return null
   const afterUrl = st.urlOf(after)
   const beforeUrl = st.urlOf(st.before)
   const r = st.result(after)
   const sides = ['source', ...st.done.map((m) => m.id)]
   const pick = (value: string, set: (v: string) => void, title: string) => (
      <select value={value} title={title} onChange={(e) => set(e.target.value)}>
         {sides.map((id) => (
            <option key={id} value={id}>
               {st.nameOf(id)}
            </option>
         ))}
      </select>
   )
   return (
      <div className="pair">
         <div className="pairBar">
            {pick(st.before, (v) => st.set('before', v), 'the before')}
            <button title="swap the two sides" onClick={() => st.swapPair()}>
               ⇄
            </button>
            {pick(after, (v) => st.set('after', v), 'the after')}
            <span className="modes">
               <span className="seg">
                  {COMPARE_MODES.map((m) => {
                     const o = MODES.find((x) => x.mode === m)
                     return (
                        <button key={m} title={`${o?.tip ?? m} (D cycles, ⇧D back)`} className={st.mode === m ? 'on' : ''} onClick={() => st.setMode(m)}>
                           {o?.glyph ?? m}
                        </button>
                     )
                  })}
               </span>
               <kbd>D</kbd>
               {st.mode === 'onion' && (
                  <input
                     type="range"
                     min={0}
                     max={1}
                     step={0.05}
                     value={st.opacity}
                     title={`after ${Math.round(st.opacity * 100)} %`}
                     onChange={(e) => st.set('opacity', Number(e.currentTarget.value))}
                  />
               )}
            </span>
            <ZoomBar st={st} />
            <span className="dim meta">
               {r?.status === 'done' ? `${timeOf(r)} · ${r.width}×${r.height}` : ''}
            </span>
            {afterUrl != null && (
               <a className="ghost" href={afterUrl} download={`${st.source?.name.replace(/\.\w+$/, '') ?? 'image'}.${after}.x${st.scale}.png`}>
                  download
               </a>
            )}
            <button className="ghost" title="close (Esc)" onClick={() => st.closePair()}>
               close
            </button>
         </div>
         {afterUrl != null && beforeUrl != null ? (
            <Stage st={st} before={beforeUrl} after={afterUrl} />
         ) : (
            <div className="err">this side has no finished result yet</div>
         )}
         <div className="dim small keys">
            wheel or pinch: zoom at the pointer · drag: pan · double click: 100 % there, or the whole image · + − 0 (fit) 1 (100 %) · D cycles the modes · Esc
            closes
         </div>
      </div>
   )
})
