// layout root: form column + results column, placed by the preview panel's own buttons.
// NO title bar and no menu: ⌘K / ⌘J or the workflow head box opens the omnibox
import { observer } from 'mobx-react-lite'
import { useEffect, useState, type ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { Gallery } from 'src/cli/serve/web/components/Gallery.tsx'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { Omnibox, useOmniboxShortcut } from 'src/cli/serve/web/components/Omnibox.tsx'
import { TooltipLayer } from 'src/cli/serve/web/components/TooltipLayer.tsx'
import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import { GenerateButton, VarsForm } from 'src/cli/serve/web/components/VarsForm.tsx'
import { LAYOUTS, type WebSt } from 'src/cli/serve/web/state/WebSt.ts'

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
         {form.previewError != null ? <div className="error">🔴 preview: {form.previewError}</div> : null}
         {names.map((name) => {
            const key = `${form.moduleKey}/${name}`
            const expanded = p.st.expandedPreviews.includes(key)
            const lines = (form.previews[name] ?? '…').split('\n').filter((l) => l.trim() !== '')
            return (
               <button
                  key={name}
                  type="button"
                  className={expanded ? 'live-preview expanded' : 'live-preview'}
                  data-tip={expanded ? 'click to show one line each' : 'click for the full text'}
                  onClick={() => p.st.togglePreviewExpanded(key)}
               >
                  <span className="live-preview-name">{name}</span>
                  <span className="live-preview-lines">
                     {lines.map((line, ix) =>
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

const ResultsHead = observer(function ResultsHead(p: { st: WebSt }) {
   return (
      <div className="results-head">
         {/* a caption over each group: three unlabelled icon strips read as one */}
         <div className="head-group-labeled">
            <span className="group-caption">preview</span>
            <span className="btn-group">
               {LAYOUTS.map((l) => (
                  <button
                     key={l.id}
                     type="button"
                     className={p.st.layout === l.id ? 'sel' : ''}
                     data-tip={l.title}
                     onClick={() => p.st.setLayout(l.id)}
                  >
                     <Icon name={l.icon} />
                  </button>
               ))}
            </span>
         </div>
         <div className="head-group-labeled">
            <span className="group-caption">while running</span>
            <span className="btn-group">
               <button
                  type="button"
                  className={p.st.showLatent ? 'sel' : ''}
                  data-tip={p.st.showLatent ? 'hide the latent preview during a run' : 'show the latent preview'}
                  onClick={() => p.st.toggleLatent()}
               >
                  <Icon name="image" />
               </button>
               <button
                  type="button"
                  className={p.st.showLogs ? 'sel' : ''}
                  data-tip={p.st.showLogs ? 'hide the ComfyUI console' : 'show the ComfyUI console'}
                  onClick={() => p.st.toggleLogs()}
               >
                  <Icon name="terminal" />
               </button>
            </span>
         </div>
         <div className="head-group-labeled">
            <span className="group-caption">results</span>
            <span className="row-inline results-view">
               <span className="btn-group">
                  <button
                     type="button"
                     className={p.st.resultsView === 'fit' ? 'sel' : ''}
                     data-tip="fit: one image per row, as wide as this panel"
                     onClick={() => p.st.setResultsView('fit')}
                  >
                     <Icon name="rows" />
                  </button>
                  <button
                     type="button"
                     className={p.st.resultsView === 'grid' ? 'sel' : ''}
                     data-tip="grid: images at the size you set, as many per row as fit"
                     onClick={() => p.st.setResultsView('grid')}
                  >
                     <Icon name="grid" />
                  </button>
               </span>
               {p.st.resultsView === 'grid' ? (
                  <input
                     type="range"
                     className="setting-range"
                     min={120}
                     max={640}
                     step={20}
                     value={p.st.resultsSize}
                     data-tip={`image size ${p.st.resultsSize}px`}
                     onChange={(e) => p.st.setResultsSize(Number(e.target.value))}
                  />
               ) : null}
            </span>
         </div>
         <div className="head-group-labeled">
            <span className="group-caption">
               blur <span className="kbd-hint">{MOD_KEY}B</span>
            </span>
            <span className="btn-group">
               <button
                  type="button"
                  className={p.st.blurResults ? 'sel' : ''}
                  data-tip={
                     p.st.blurResults
                        ? `blurred until you hover: click (or ${MOD_KEY}B) for always clear`
                        : `always clear: click (or ${MOD_KEY}B) to blur until you hover`
                  }
                  onClick={() => p.st.toggleBlur()}
               >
                  <Icon name={p.st.blurResults ? 'eye-off' : 'eye'} />
               </button>
            </span>
         </div>
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

export const App = observer(function App(p: { st: WebSt }) {
   const narrow = useNarrow()
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
               {p.st.run.error != null ? <span className="error">🔴 {p.st.run.error}</span> : null}
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
   return (
      <div className="app">
         <div className="cols">
            {split ? (
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
            )}
         </div>
         <Omnibox st={p.st} />
         <TooltipLayer />
      </div>
   )
})
