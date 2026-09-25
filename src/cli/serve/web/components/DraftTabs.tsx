// the open drafts as tabs over the work area: a click opens one, × or a middle click closes it,
// ⌘1 to ⌘8 pick one, ⌘9 the last (ctrl elsewhere), from any focus
import { observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import { tabForKey } from 'src/cli/serve/web/state/draftTabs.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export function useTabShortcuts(st: WebSt): void {
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         const t = tabForKey(st.tabs, e)
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
                  data-tip={`${t.module} / ${t.draft}${key == null ? '' : `\n${key}`}`}
                  onClick={() => void p.st.select(t)}
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
      </div>
   )
})
