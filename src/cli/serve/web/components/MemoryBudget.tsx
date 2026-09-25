// beside blur: how much of the server's memory budget the unsaved outputs hold, and a popover to
// change that budget. The server drops the oldest unsaved outputs first once it is full
import {
   autoUpdate,
   flip,
   FloatingPortal,
   offset,
   shift,
   useDismiss,
   useFloating,
   useInteractions,
} from '@floating-ui/react'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { formatMb } from 'src/cli/serve/web/state/keptResults.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const BUDGET_CHOICES_MB = [25, 50, 100, 250, 500, 1000, 2000]

export const MemoryBudgetButton = observer(function MemoryBudgetButton(p: { st: WebSt }) {
   const [anchor, setAnchor] = useState<HTMLElement | null>(null)
   const [open, setOpen] = useState(false)
   const memory = p.st.run.memory
   const budgetMb = p.st.settings.memoryBudgetMb
   return (
      <>
         <button
            type="button"
            ref={setAnchor}
            className={open ? 'sel' : ''}
            data-tip="unsaved results kept in the server memory: click to change the budget"
            onClick={() => {
               if (!open) void p.st.run.refreshMemory()
               setOpen(!open)
            }}
         >
            <Icon name="memory" />
            {memory == null ? `${budgetMb} MB` : `${formatMb(memory.usedBytes)}/${budgetMb} MB`}
         </button>
         {open && anchor != null ? <MemoryMenu st={p.st} anchor={anchor} onClose={() => setOpen(false)} /> : null}
      </>
   )
})

const MemoryMenu = observer(function MemoryMenu(p: { st: WebSt; anchor: HTMLElement; onClose: () => void }) {
   const { refs, floatingStyles, context } = useFloating({
      open: true,
      onOpenChange: (open) => {
         if (!open) p.onClose()
      },
      placement: 'bottom-end',
      middleware: [offset(4), flip(), shift({ padding: 8 })],
      whileElementsMounted: autoUpdate,
      elements: { reference: p.anchor },
   })
   const { getFloatingProps } = useInteractions([useDismiss(context)])
   const memory = p.st.run.memory
   const budgetMb = p.st.settings.memoryBudgetMb
   // a hand-written budget off the list still shows as the selected value
   const choices = BUDGET_CHOICES_MB.includes(budgetMb)
      ? BUDGET_CHOICES_MB
      : [...BUDGET_CHOICES_MB, budgetMb].sort((a, b) => a - b)
   return (
      <FloatingPortal>
         <div ref={refs.setFloating} style={floatingStyles} className="tab-menu memory-menu" {...getFloatingProps()}>
            <div className="menu-row">
               <Icon name="memory" />
               <span className="menu-value">server memory</span>
            </div>
            <p className="hint memory-note">
               Unsaved results live in the serve process only: a page reload shows them again, a server restart loses
               them. Past the budget, the oldest go first.
            </p>
            <label className="menu-row">
               <span>budget</span>
               <select
                  className="menu-select"
                  value={budgetMb}
                  onChange={(e) => void p.st.setMemoryBudget(Number(e.target.value))}
               >
                  {choices.map((mb) => (
                     <option key={mb} value={mb}>
                        {mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`}
                     </option>
                  ))}
               </select>
            </label>
            <div className="hint memory-note">
               {memory == null
                  ? 'usage not read yet'
                  : `${formatMb(memory.usedBytes)} MB used by ${memory.outputs} unsaved output${memory.outputs === 1 ? '' : 's'}, ${memory.runs} run${memory.runs === 1 ? '' : 's'} kept`}
            </div>
            {p.st.savingError != null ? <div className="error memory-note">{p.st.savingError}</div> : null}
         </div>
      </FloatingPortal>
   )
})
