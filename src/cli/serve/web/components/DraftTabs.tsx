// the open drafts as tabs over the work area: a click opens one (a click on the open one shows
// its actions), × or a middle click closes it, ⌘1 to ⌘8 pick one, ⌘9 the last, ⌘PageUp and
// ⌘PageDown step (ctrl elsewhere), from any focus
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
import { useEffect, useState } from 'react'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import { tabForKey, tabStepForKey, type DraftTab } from 'src/cli/serve/web/state/draftTabs.ts'
import { shortcutLabel } from 'src/cli/serve/web/state/shortcuts.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export function useTabShortcuts(st: WebSt): void {
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         const t = tabForKey(st.tabs, e) ?? tabStepForKey(st.tabs, st.activeTab, e)
         if (t == null) return
         e.preventDefault()
         void st.select(t)
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [st])
}

export const DraftTabs = observer(function DraftTabs(p: { st: WebSt }) {
   const active = p.st.activeTab
   const tabs = p.st.tabs
   /** the open tab's element while its actions show, null when they do not */
   const [menuAt, setMenuAt] = useState<HTMLElement | null>(null)
   if (tabs.length === 0) return null
   return (
      <div className="draft-tabs" role="tablist">
         {tabs.map((t, ix) => {
            const on = active != null && active.module === t.module && active.draft === t.draft
            const key = ix < 8 ? `${MOD_KEY}${ix + 1}` : ix === tabs.length - 1 ? `${MOD_KEY}9` : null
            return (
               <div
                  key={`${t.module}/${t.draft}`}
                  role="tab"
                  aria-selected={on}
                  className={on ? 'draft-tab on' : 'draft-tab'}
                  data-tip={`${t.module} / ${t.draft}${key == null ? '' : `\n${key}`}${on ? '\nclick: rename, duplicate, delete' : ''}`}
                  onClick={(e) => {
                     // another tab is a jump; the open one has nowhere to jump, so it shows its actions
                     if (on) setMenuAt(e.currentTarget)
                     else void p.st.select(t)
                  }}
                  onAuxClick={(e) => {
                     if (e.button !== 1) return
                     e.preventDefault()
                     p.st.closeTab(t)
                  }}
               >
                  <span className="draft-tab-name">
                     {t.draft}
                     {/* two open drafts share the name (default, default): the workflow tells them apart */}
                     {tabs.some((o) => o.draft === t.draft && o.module !== t.module) ? (
                        <span className="draft-tab-wf"> · {t.module}</span>
                     ) : null}
                  </span>
                  {tabs.length > 1 ? (
                     <button
                        type="button"
                        className="draft-tab-close"
                        aria-label={`close ${t.draft}`}
                        onClick={(e) => {
                           e.stopPropagation()
                           p.st.closeTab(t)
                        }}
                     >
                        <Icon name="close" size={0.8} />
                     </button>
                  ) : null}
               </div>
            )
         })}
         {menuAt != null && active != null ? (
            <TabMenu st={p.st} tab={active} anchor={menuAt} onClose={() => setMenuAt(null)} />
         ) : null}
      </div>
   )
})

/** under the open tab: its name to edit (focused, enter renames), then the other draft actions.
 * In a portal: the tab bar scrolls sideways and would clip it */
const TabMenu = observer(function TabMenu(p: { st: WebSt; tab: DraftTab; anchor: HTMLElement; onClose: () => void }) {
   const [name, setName] = useState(p.tab.draft)
   const { refs, floatingStyles, context } = useFloating({
      open: true,
      onOpenChange: (open) => {
         if (!open) p.onClose()
      },
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })],
      whileElementsMounted: autoUpdate,
      elements: { reference: p.anchor },
   })
   const { getFloatingProps } = useInteractions([useDismiss(context)])
   const run = (action: () => unknown): void => {
      p.onClose()
      void action()
   }
   const rename = (): void => {
      const next = name.trim()
      run(() => (next !== '' && next !== p.tab.draft ? p.st.renameDraft(next) : undefined))
   }
   return (
      <FloatingPortal>
         <div ref={refs.setFloating} style={floatingStyles} className="tab-menu" {...getFloatingProps()}>
            <input
               type="text"
               className="head-input"
               autoFocus
               value={name}
               aria-label="draft name"
               placeholder="new name, then enter"
               onFocus={(e) => e.currentTarget.select()}
               onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => {
                  if (e.key === 'Enter') rename()
                  if (e.key === 'Escape') p.onClose()
               }}
            />
            <button
               type="button"
               className="menu-row menu-action"
               onClick={() => run(() => p.st.duplicateCurrentDraft())}
            >
               <Icon name="copy-plus" />
               <span>duplicate</span>
               <span className="kbd-hint">{shortcutLabel('duplicate-draft')}</span>
            </button>
            <button
               type="button"
               className="menu-row menu-action"
               onClick={() => run(() => p.st.newDraftFromDefaults())}
            >
               <Icon name="plus" />
               <span>new default</span>
            </button>
            <button
               type="button"
               className="menu-row menu-action danger"
               onClick={() =>
                  run(() => {
                     if (window.confirm(`delete draft '${p.tab.draft}' of ${p.tab.module}? the file is removed.`))
                        return p.st.deleteDraft(p.tab)
                  })
               }
            >
               <Icon name="trash" />
               <span>delete</span>
            </button>
         </div>
      </FloatingPortal>
   )
})
