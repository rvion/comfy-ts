// the panel's own dropdown for a single choice: each row its thumbnail, name, description,
// badges (date, size, speed, tags) and a 1..5 quality bar, read from `.ui({ options })`. A list
// longer than FILTER_FROM gets a filter box. Keys: arrows move, enter picks, escape closes,
// typing filters. A value outside the list (a stale draft) is said, never shown as an option.
// An optional choice (`select: 'zero-or-one'`) gets a first row « none », which picks null
import {
   autoUpdate,
   flip,
   FloatingPortal,
   offset,
   shift,
   size,
   useDismiss,
   useFloating,
   useInteractions,
} from '@floating-ui/react'
import { observer, useLocalObservable } from 'mobx-react-lite'
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { VarIcon } from 'src/cli/serve/web/components/VarIcon.tsx'
import { onEscape } from 'src/cli/serve/web/state/escape.ts'
import type { ChoiceOptionLook } from 'src/vars/ComfyVars.ts'

const FILTER_FROM = 8

function Quality(p: { value: number | undefined }): ReactNode {
   if (p.value == null) return null
   const q = Math.max(0, Math.min(5, Math.round(p.value)))
   return (
      <span className="rs-quality" data-tip={`quality ${q} of 5`}>
         {[1, 2, 3, 4, 5].map((i) => (
            <i key={i} className={i <= q ? 'on' : ''} />
         ))}
      </span>
   )
}

function Badges(p: { look: ChoiceOptionLook | undefined }): ReactNode {
   const l = p.look
   if (l == null) return null
   const items = [l.date, l.size, l.speed, ...(l.tags ?? [])].filter((x): x is string => x != null && x !== '')
   if (items.length === 0 && l.quality == null) return null
   return (
      <span className="rs-badges">
         {items.map((b) => (
            <span key={b} className="rs-badge">
               {b}
            </span>
         ))}
         <Quality value={l.quality} />
      </span>
   )
}

function Thumb(p: { look: ChoiceOptionLook | undefined; big?: boolean }): ReactNode {
   const cls = p.big === true ? 'rs-thumb big' : 'rs-thumb'
   if (p.look?.thumb != null) return <img className={cls} src={p.look.thumb} alt="" loading="lazy" />
   if (p.look?.icon != null)
      return (
         <span className={`${cls} icon`}>
            <VarIcon icon={p.look.icon} color={p.look.color} />
         </span>
      )
   return null
}

const nameOf = (value: string, look: ChoiceOptionLook | undefined): string => look?.label ?? value

/** the « none » row of an optional choice: a key no option can hold */
const NONE = '\u0000none'

export const RichSelect = observer(function RichSelect(p: {
   choices: readonly string[]
   /** null: nothing picked (an optional choice) */
   value: string | null
   looks: Record<string, ChoiceOptionLook>
   /** an optional choice: the list starts with « none » */
   allowNone?: boolean
   onPick: (value: string | null) => void
}) {
   const st = useLocalObservable(() => ({
      open: false,
      query: '',
      active: 0,
      setOpen(v: boolean) {
         this.open = v
         this.query = ''
      },
      setQuery(q: string) {
         this.query = q
         this.active = 0
      },
      setActive(i: number) {
         this.active = i
      },
   }))
   const { refs, floatingStyles, context } = useFloating({
      open: st.open,
      onOpenChange: (o) => st.setOpen(o),
      placement: 'bottom-start',
      middleware: [
         offset(4),
         flip(),
         shift({ padding: 8 }),
         size({
            padding: 8,
            apply({ availableHeight, rects, elements }) {
               elements.floating.style.maxHeight = `${Math.max(180, availableHeight)}px`
               elements.floating.style.minWidth = `${Math.max(360, rects.reference.width)}px`
            },
         }),
      ],
      whileElementsMounted: autoUpdate,
   })
   const { getReferenceProps, getFloatingProps } = useInteractions([useDismiss(context)])
   const filterRef = useRef<HTMLInputElement>(null)
   const listRef = useRef<HTMLDivElement>(null)

   const q = st.query.trim().toLowerCase()
   const value = p.value ?? (p.allowNone === true ? NONE : '')
   const rows = p.allowNone === true ? [NONE, ...p.choices] : p.choices
   const shown = rows.filter((c) => {
      if (q === '') return true
      if (c === NONE) return 'none'.includes(q)
      const l = p.looks[c]
      return [c, l?.label, l?.description, ...(l?.tags ?? [])].some((s) => s?.toLowerCase().includes(q) === true)
   })
   const current = p.value == null ? undefined : p.looks[p.value]
   const stale = value !== '' && value !== NONE && !p.choices.includes(value)

   useEffect(() => {
      if (!st.open) return
      const ix = shown.indexOf(value)
      st.setActive(ix >= 0 ? ix : 0)
      if (p.choices.length >= FILTER_FROM) filterRef.current?.focus()
      else listRef.current?.focus()
   }, [st.open])
   useEffect(() => {
      listRef.current?.querySelector('.rs-row.active')?.scrollIntoView({ block: 'nearest' })
   }, [st.active, st.open])

   const pick = (c: string): void => {
      p.onPick(c === NONE ? null : c)
      st.setOpen(false)
   }
   const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
         e.preventDefault()
         const n = shown.length
         if (n > 0) st.setActive((st.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
      } else if (e.key === 'Enter') {
         e.preventDefault()
         const c = shown[st.active]
         if (c != null) pick(c)
      } else
         onEscape(e, () => {
            e.stopPropagation()
            st.setOpen(false)
         })
   }

   return (
      <>
         <button
            type="button"
            ref={refs.setReference}
            className={st.open ? 'rs-trigger open' : 'rs-trigger'}
            {...getReferenceProps({
               onClick: () => st.setOpen(!st.open),
               onKeyDown: (e) => {
                  if (!st.open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
                     e.preventDefault()
                     st.setOpen(true)
                  }
               },
            })}
         >
            <Thumb look={current} />
            <span className="rs-trigger-text">
               <span className="rs-name">
                  {value === NONE
                     ? 'none'
                     : value === ''
                       ? '(unset)'
                       : stale
                         ? `${value} (not on this host)`
                         : nameOf(value, current)}
               </span>
               {current?.label != null ? <span className="rs-value">{value}</span> : null}
            </span>
            <Badges look={current} />
            <span className="rs-chevron">▾</span>
         </button>
         {st.open ? (
            <FloatingPortal>
               <div ref={refs.setFloating} style={floatingStyles} className="rs-pop" {...getFloatingProps()}>
                  {p.choices.length >= FILTER_FROM ? (
                     <input
                        ref={filterRef}
                        className="rs-filter"
                        placeholder={`filter ${p.choices.length} options`}
                        value={st.query}
                        onChange={(e) => st.setQuery(e.target.value)}
                        onKeyDown={onKey}
                     />
                  ) : null}
                  <div ref={listRef} className="rs-list" role="listbox" tabIndex={-1} onKeyDown={onKey}>
                     {shown.length === 0 ? <div className="rs-empty">nothing matches</div> : null}
                     {shown.map((c, i) => {
                        if (c === NONE)
                           return (
                              <div
                                 key={c}
                                 role="option"
                                 aria-selected={value === NONE}
                                 className={`rs-row rs-none${i === st.active ? ' active' : ''}${value === NONE ? ' sel' : ''}`}
                                 onMouseEnter={() => st.setActive(i)}
                                 onClick={() => pick(c)}
                              >
                                 <span className="rs-thumb big icon">∅</span>
                                 <span className="rs-row-text">
                                    <span className="rs-name">none</span>
                                    <span className="rs-desc">leave this out of the run</span>
                                 </span>
                                 {value === NONE ? <span className="rs-check">✓</span> : null}
                              </div>
                           )
                        const look = p.looks[c]
                        return (
                           <div
                              key={c}
                              role="option"
                              aria-selected={c === value}
                              className={`rs-row${i === st.active ? ' active' : ''}${c === value ? ' sel' : ''}`}
                              onMouseEnter={() => st.setActive(i)}
                              onClick={() => pick(c)}
                           >
                              <Thumb look={look} big />
                              <span className="rs-row-text">
                                 <span className="rs-row-head">
                                    <span className="rs-name">{nameOf(c, look)}</span>
                                    {look?.label != null ? <span className="rs-value">{c}</span> : null}
                                 </span>
                                 {look?.description != null ? <span className="rs-desc">{look.description}</span> : null}
                                 <Badges look={look} />
                              </span>
                              {c === value ? <span className="rs-check">✓</span> : null}
                           </div>
                        )
                     })}
                  </div>
                  <div className="rs-foot">
                     {p.choices.length === 1 ? 'the only option on this host' : `${p.choices.length} options`} · ↑↓ ⏎ esc
                  </div>
               </div>
            </FloatingPortal>
         ) : null}
      </>
   )
})
