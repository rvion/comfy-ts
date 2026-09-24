// a ⋯ button and the small menu it opens: where the rarely used actions go, so a row shows its
// content instead of a strip of buttons. A backdrop under the menu closes it on any outside
// click, no document listener to leak
import { useState, type ReactNode } from 'react'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'

export function MenuButton(p: {
   tip: string
   className?: string
   /** the menu body; `close` is handed over so an item can shut the menu after acting */
   children: (close: () => void) => ReactNode
}): ReactNode {
   const [open, setOpen] = useState(false)
   const close = (): void => setOpen(false)
   return (
      <span
         className={`preset-box menu-box ${p.className ?? ''}`}
         onKeyDown={(e) => (e.key === 'Escape' ? close() : undefined)}
      >
         <button
            type="button"
            className="menu-btn"
            aria-expanded={open}
            data-tip={p.tip}
            onClick={() => setOpen(!open)}
         >
            <Icon name="more" />
         </button>
         {open ? (
            <>
               <div className="preset-backdrop" onClick={close} />
               <div className="preset-menu menu-list">{p.children(close)}</div>
            </>
         ) : null}
      </span>
   )
}

/** one menu line: a button, or a checkbox line when `checked` is given */
export function MenuItem(p: {
   label: ReactNode
   onClick: () => void
   checked?: boolean
   disabled?: boolean
   tip?: string
}): ReactNode {
   return (
      <button type="button" className="menu-item" disabled={p.disabled} data-tip={p.tip} onClick={p.onClick}>
         <span className="menu-check">{p.checked == null ? '' : p.checked ? '✓' : ''}</span>
         {p.label}
      </button>
   )
}
