// layout root: the menu column (SideMenu.tsx), then the form and results columns placed by
// the preview panel's own buttons. At 760px and below the menu is a drawer behind ☰
import { observer } from 'mobx-react-lite'
import { useEffect, useState, type ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import { MenuCards, MenuHead, MenuRail } from 'src/cli/serve/web/components/SideMenu.tsx'
import { Gallery } from 'src/cli/serve/web/components/Gallery.tsx'
import { Icon, type IconName } from 'src/cli/serve/web/components/Icon.tsx'
import { LATENT_MODES, type LatentMode } from 'src/cli/serve/web/state/latentMode.ts'
import { Omnibox, useOmniboxShortcut } from 'src/cli/serve/web/components/Omnibox.tsx'
import { TooltipLayer } from 'src/cli/serve/web/components/TooltipLayer.tsx'
import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import { SHORTCUT_KEYS, shortcutOf } from 'src/cli/serve/web/state/shortcuts.ts'
import { reaction } from 'mobx'
import { collapsedPreview } from 'src/cli/serve/web/state/stableSlots.ts'
import { GenerateButton, VarsForm } from 'src/cli/serve/web/components/VarsForm.tsx'
import { DraftTabs, useTabShortcuts } from 'src/cli/serve/web/components/DraftTabs.tsx'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

/** ⌘A / ctrl+A selects the field you are in. The browser does this on its own until something
 * on the page consumes the event, and this panel has several window-level key handlers plus a
 * drag layer over the rows, rather than hunt which one wins on which browser, the select is
 * performed explicitly. It runs ONLY when focus is already in a text field, so the
 * whole-page select-all everywhere else is untouched. */
function useSelectAllInFields(): void {
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (e.key !== 'a' && e.key !== 'A') return
         if (!e.metaKey && !e.ctrlKey) return
         if (e.altKey) return
         const el = document.activeElement
         const editable =
            el instanceof HTMLInputElement
               ? // a number/checkbox input has no text to select
                 el.type === 'text' || el.type === 'search' || el.type === 'password' || el.type === 'url'
               : el instanceof HTMLTextAreaElement
         if (!editable) return
         e.preventDefault()
         ;(el as HTMLInputElement | HTMLTextAreaElement).select()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [])
}

/** the preview panel's own controls, on top of it: where it sits, what shows while it runs */
/** the workflow's live previews (defineWorkflow({ previews })): text computed from the values
 * on screen, refreshed as you edit. Compact by default, the name inline and every line cut to
 * one; a click opens the full text, remembered. A `- ` line is the negative, as in a prompt */
const LivePreviews = observer(function LivePreviews(p: { st: WebSt }) {
   const form = p.st.form
   const names = form == null ? [] : (p.st.moduleByKey(form.moduleKey)?.previews ?? [])
   if (form == null || names.length === 0) return null
   return (
      <div className="live-previews">
         {names.map((name) => {
            const key = `${form.moduleKey}/${name}`
            const expanded = p.st.expandedPreviews.includes(key)
            const text = form.previews[name] ?? '…'
            const lines = text.split('\n').filter((l) => l.trim() !== '')
            // collapsed = exactly two lines whatever the prompt holds, so typing never moves the
            // gallery; the full text is one click away
            const short = collapsedPreview(text)
            return (
               <button
                  key={name}
                  type="button"
                  className={expanded ? 'live-preview expanded' : 'live-preview'}
                  data-tip={expanded ? 'click to show one line each' : 'click for the full text'}
                  onClick={() => p.st.togglePreviewExpanded(key)}
               >
                  <span className="live-preview-name">
                     {name}
                     {form.previewError == null ? null : (
                        <span className="live-preview-error" data-tip={`preview failed: ${form.previewError}`}>
                           🔴
                        </span>
                     )}
                  </span>
                  <span className="live-preview-lines">
                     {!expanded ? (
                        <>
                           <span className="live-preview-line">{short.positive}</span>
                           <span className="live-preview-line negative">
                              {short.negative === '' ? '' : `− ${short.negative}`}
                           </span>
                        </>
                     ) : null}
                     {expanded &&
                        lines.map((line, ix) =>
                           line.startsWith('- ') ? (
                              // index keys: a preview's lines have no identity of their own
                              <span key={ix} className="live-preview-line negative">
                                 − {line.slice(2)}
                              </span>
                           ) : (
                              <span key={ix} className="live-preview-line">
                                 {line}
                              </span>
                           ),
                        )}
                  </span>
               </button>
            )
         })}
      </div>
   )
})

const LATENT_ICON: Record<LatentMode, IconName> = { full: 'image', corner: 'panel-corner', off: 'panel-off' }

const ResultsHead = observer(function ResultsHead(p: { st: WebSt }) {
   return (
      <div className="results-head">
         {/* a caption over each group: unlabelled icon strips read as one. Placement is page
             layout, so it lives in the menu column */}
         <div className="head-group-labeled">
            <span className="group-caption">while running</span>
            <span className="row-inline head-row">
               <span className="btn-group">
                  {LATENT_MODES.map((m) => (
                     <button
                        key={m.mode}
                        type="button"
                        className={p.st.latentMode === m.mode ? 'sel' : ''}
                        data-tip={m.tip}
                        onClick={() => p.st.setLatentMode(m.mode)}
                     >
                        <Icon name={LATENT_ICON[m.mode]} />
                     </button>
                  ))}
               </span>
            </span>
         </div>
         <label className="cols-field" data-tip="results side by side: 1 is one image as wide as this panel">
            <Icon name="grid" />
            <input
               type="number"
               min={1}
               max={8}
               step={1}
               value={p.st.resultsColumns}
               onChange={(e) => {
                  const n = Number(e.target.value)
                  if (e.target.value !== '' && Number.isFinite(n)) p.st.setResultsColumns(n)
               }}
            />
            cols
         </label>
         <span className="btn-group">
            <button
               type="button"
               className={p.st.blurResults ? 'sel' : ''}
               data-tip={
                  p.st.blurResults
                     ? 'blurred until you hover: click for always clear'
                     : 'always clear: click to blur until you hover'
               }
               onClick={() => p.st.toggleBlur()}
            >
               <Icon name={p.st.blurResults ? 'eye-off' : 'eye'} /> blur
               <span className="kbd-hint">
                  {MOD_KEY}
                  {SHORTCUT_KEYS['toggle-blur']}
               </span>
            </button>
         </span>
      </div>
   )
})

/** below this width two side by side panels leave the form unusable, so a side placement
 * stacks: the chosen mode adapting, the button stays lit */
const SPLIT_MIN_WIDTH = 760

function useNarrow(): boolean {
   const query = `(max-width: ${SPLIT_MIN_WIDTH}px)`
   const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
   useEffect(() => {
      const mq = window.matchMedia(query)
      const on = (): void => setNarrow(mq.matches)
      mq.addEventListener('change', on)
      return () => mq.removeEventListener('change', on)
   }, [query])
   return narrow
}

/** the sizes you drag are kept in this browser; a blocked storage just forgets them */
const splitStorage = {
   getItem: (key: string): string | null => {
      try {
         return localStorage.getItem(key)
      } catch {
         return null
      }
   },
   setItem: (key: string, value: string): void => {
      try {
         localStorage.setItem(key, value)
      } catch {
         // storage full or blocked: the split just is not remembered
      }
   },
}

const SplitWork = observer(function SplitWork(p: { st: WebSt; left: boolean; form: ReactNode; results: ReactNode }) {
   // one remembered layout per side: dragging the left split does not move the right one
   const id = p.left ? 'comfy-ts-split-left' : 'comfy-ts-split-right'
   const saved = useDefaultLayout({ id, storage: splitStorage })
   const formPanel = (
      <Panel id="form" minSize="30%" className="split-panel split-form">
         {p.form}
      </Panel>
   )
   const resultsPanel = (
      <Panel id="results" defaultSize="34%" minSize="16%" className="split-panel split-results">
         {p.results}
      </Panel>
   )
   return (
      <Group
         key={id}
         id={id}
         orientation="horizontal"
         // NOT the layout-side / layout-left classes: those style the stacked page, and one of
         // their rules (align-items: flex-start) kept the panels from stretching to the window,
         // so they grew with the form and the window cut it off, with nothing to scroll
         className={`work split split-${p.left ? 'left' : 'right'}`}
         defaultLayout={saved.defaultLayout}
         onLayoutChanged={saved.onLayoutChanged}
      >
         {p.left ? resultsPanel : formPanel}
         <Separator className="split-handle" />
         {p.left ? formPanel : resultsPanel}
      </Group>
   )
})

/** px: the rail is one icon wide, and a column dragged below MENU_MIN snaps to it */
const MENU_RAIL = 48
const MENU_MIN = 180

/** the menu as a resizable left Panel: its size and its collapsed state are kept in this
 * browser, like the form and results split */
const MenuLayout = observer(function MenuLayout(p: { st: WebSt; main: ReactNode }) {
   const saved = useDefaultLayout({ id: 'comfy-ts-menu', storage: splitStorage })
   const menuRef = usePanelRef()
   const [collapsed, setCollapsed] = useState(false)
   // ⌘B and ☰ bump the tick; folding is the Panel's own state, so it is remembered with its size
   useEffect(
      () =>
         reaction(
            () => p.st.menuFoldTick,
            () => {
               const panel = menuRef.current
               if (panel == null) return
               if (panel.isCollapsed()) panel.expand()
               else panel.collapse()
            },
         ),
      [p.st, menuRef],
   )
   return (
      <Group
         id="comfy-ts-menu"
         orientation="horizontal"
         className="menu-layout"
         defaultLayout={saved.defaultLayout}
         onLayoutChanged={saved.onLayoutChanged}
      >
         <Panel
            id="menu"
            panelRef={menuRef}
            defaultSize={220}
            minSize={MENU_MIN}
            maxSize={420}
            collapsible
            collapsedSize={MENU_RAIL}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => setCollapsed(size.inPixels < MENU_MIN - 1)}
            className="menu-panel"
         >
            {collapsed ? (
               <MenuRail st={p.st} onExpand={() => menuRef.current?.expand()} />
            ) : (
               <div className="menu-col">
                  <MenuHead
                     tip={`fold the menu to icons (${MOD_KEY}B), it stays folded in this browser`}
                     keyHint={`${MOD_KEY}${SHORTCUT_KEYS['toggle-menu']}`}
                     onBurger={() => menuRef.current?.collapse()}
                  />
                  <MenuCards st={p.st} />
               </div>
            )}
         </Panel>
         <Separator className="split-handle" />
         <Panel id="main" minSize="40%" className="menu-main">
            {p.main}
         </Panel>
      </Group>
   )
})

/** phones: a slim bar naming where you are, the whole menu one tap away */
const MobileBar = observer(function MobileBar(p: { st: WebSt }) {
   const form = p.st.form
   return (
      <div className="mobile-bar">
         <button type="button" className="head-icon" aria-label="menu" onClick={() => p.st.setMenuOpen(true)}>
            <Icon name="menu" />
         </button>
         <button type="button" className="mobile-where" onClick={() => p.st.omnibox.open()}>
            <span className="menu-value mobile-workflow">{form?.moduleKey ?? 'no workflow'}</span>
            {form == null ? null : <span className="mobile-draft"> · {form.draft}</span>}
         </button>
      </div>
   )
})

const MenuDrawer = observer(function MenuDrawer(p: { st: WebSt }) {
   if (!p.st.menuOpen) return null
   return (
      <div className="drawer-overlay" onClick={() => p.st.setMenuOpen(false)}>
         <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <MenuHead
               tip="close the menu"
               keyHint={`${MOD_KEY}${SHORTCUT_KEYS['toggle-menu']}`}
               onBurger={() => p.st.setMenuOpen(false)}
            />
            <MenuCards st={p.st} />
         </div>
      </div>
   )
})

/** ⌘B (ctrl elsewhere) folds the menu column, or opens and closes the drawer on a phone */
function useMenuShortcut(st: WebSt, narrow: boolean): void {
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (shortcutOf(e) !== 'toggle-menu') return
         e.preventDefault()
         if (narrow) st.setMenuOpen(!st.menuOpen)
         else st.requestMenuFold()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [st, narrow])
}

export const App = observer(function App(p: { st: WebSt }) {
   const narrow = useNarrow()
   useMenuShortcut(p.st, narrow)
   useTabShortcuts(p.st)
   useSelectAllInFields()
   useOmniboxShortcut(p.st)
   if (p.st.phase === 'loading') return <div className="center">loading…</div>
   if (p.st.phase === 'error')
      return (
         <div className="center">
            <div className="error">🔴 {p.st.bootError}</div>
         </div>
      )
   const layout = p.st.layout
   const formCol = (
      <div className="form-col">
         <VarsForm st={p.st} />
         {/* the ComfyUI console, only while asked for (it polls) */}
         {p.st.showLogs ? (
            <div className="logs">
               <div className="logs-head">
                  {/* the host the lines actually come from (pullLogs uses hostFor),
                      not the module's declared default */}
                  <span>console · {p.st.hostFor(p.st.form?.moduleKey ?? '') || 'host'}</span>
                  <button type="button" className="link" onClick={() => p.st.toggleLogs()}>
                     hide
                  </button>
               </div>
               {p.st.logsError != null ? <div className="error">🔴 {p.st.logsError}</div> : null}
               <pre>{p.st.logLines.join('\n')}</pre>
            </div>
         ) : null}
      </div>
   )
   const resultsCol = (
      <div className="results-col">
         <ResultsHead st={p.st} />
         {p.st.generateInResults ? (
            <div className="results-run">
               <GenerateButton st={p.st} />
               {/* one line, always reserved: an error arriving never pushes the gallery down */}
               <span className="run-error" data-tip={p.st.run.error ?? undefined}>
                  {p.st.run.error == null ? '' : `🔴 ${p.st.run.error}`}
               </span>
            </div>
         ) : null}
         <LivePreviews st={p.st} />
         <Gallery st={p.st} compact={layout === 'pinned'} />
      </div>
   )
   const notices = (
      <>
         {p.st.formError != null ? <div className="center error">🔴 {p.st.formError}</div> : null}
         {p.st.formLoading && p.st.form == null ? <div className="center">loading draft…</div> : null}
         {p.st.modules.length === 0 ? <div className="center">no workflow modules loaded</div> : null}
      </>
   )
   // left / right on a screen wide enough: two FULL-HEIGHT panels, each scrolling on its own,
   // split by a handle you drag. Everything else is one scrolling page
   const split = (layout === 'side' || layout === 'left') && !narrow
   const body = split ? (
      <SplitWork
         st={p.st}
         left={layout === 'left'}
         form={
            <>
               {notices}
               {formCol}
            </>
         }
         results={resultsCol}
      />
   ) : (
      <div className="main">
         {notices}
         {/* the layout buttons drive ONE class, and it is the whole truth: the selected
                      button always names where the panel is */}
         <div className={`work layout-${layout}`}>
            {formCol}
            {layout === 'off' ? (
               // the panel took its buttons with it: this is the way back
               <button
                  type="button"
                  className="show-preview"
                  data-tip="show the preview panel again"
                  onClick={() => p.st.showPreview()}
               >
                  <Icon name="panel-side" /> preview
               </button>
            ) : (
               resultsCol
            )}
         </div>
      </div>
   )
   return (
      <div className="app">
         {narrow ? <MobileBar st={p.st} /> : null}
         <div className="cols">
            {narrow ? (
               body
            ) : (
               <MenuLayout
                  st={p.st}
                  main={
                     <div className="tabs-col">
                        <DraftTabs st={p.st} />
                        <div className="tabs-body">{body}</div>
                     </div>
                  }
               />
            )}
         </div>
         {narrow ? <MenuDrawer st={p.st} /> : null}
         <Omnibox st={p.st} />
         <TooltipLayer />
      </div>
   )
})
