// the var rows: each kind dispatches to its matching control (the point of the
// web ui — architecture item 12) + the sticky run bar
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, type ReactNode } from 'react'
import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import { runChipText } from 'src/cli/serve/web/state/stableSlots.ts'
import { jumpTargets, SHORTCUT_KEYS, shortcutOf } from 'src/cli/serve/web/state/shortcuts.ts'
import { isPromptLanes } from 'src/vars/lanes.ts'
import {
   ChoiceControl,
   NumberControl,
   TextControl,
   ToggleControl,
} from 'src/cli/serve/web/components/controls/BasicControls.tsx'
import { PromptControl } from 'src/cli/serve/web/components/controls/PromptControl.tsx'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { VarIcon } from 'src/cli/serve/web/components/VarIcon.tsx'
import { generateButtonLook } from 'src/cli/serve/web/state/generateButton.ts'
import { groupPlaces, type GroupPlace } from 'src/cli/serve/web/state/varGroups.ts'
import { ImageControl } from 'src/cli/serve/web/components/controls/ImageControl.tsx'
import { LorasControl } from 'src/cli/serve/web/components/controls/LorasControl.tsx'
import { SeedControl } from 'src/cli/serve/web/components/controls/SeedControl.tsx'
import { SizeControl } from 'src/cli/serve/web/components/controls/SizeControl.tsx'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const VarControl = observer(function VarControl(p: {
   v: VarSt
   host: string
   st: WebSt
   module: string
   jumpTarget: boolean
}) {
   switch (p.v.desc.kind) {
      case 'prompt':
         return <PromptControl v={p.v} st={p.st} module={p.module} jumpTarget={p.jumpTarget} />
      case 'text':
         return <TextControl v={p.v} />
      case 'int':
      case 'float':
         return <NumberControl v={p.v} />
      case 'seed':
         return <SeedControl v={p.v} />
      case 'toggle':
         return <ToggleControl v={p.v} />
      case 'choice':
         return <ChoiceControl v={p.v} />
      case 'loras':
         // the OVERRIDE host, like every other host-scoped read: with `host` fixed at form
         // construction the previews, trigger words and details sheet came from the workflow's
         // own box while the manager link opened the one actually selected
         return (
            <LorasControl
               v={p.v}
               host={p.st.hostFor(p.module)}
               st={p.st}
               hostUrl={p.st.hostUrlFor(p.module)}
               jumpTarget={p.jumpTarget}
            />
         )
      case 'size':
         return <SizeControl v={p.v} st={p.st} module={p.module} />
      case 'image':
         return <ImageControl v={p.v} />
      default:
         // a newer server may describe a kind this bundle predates: stay usable
         return <div className="hint">unsupported var kind '{p.v.desc.kind}' — use the json api</div>
   }
})

const VarRow = observer(function VarRow(p: {
   v: VarSt
   host: string
   st: WebSt
   module: string
   index: number
   names: readonly string[]
   /** where this row sits in a block of vars that go together, null outside any */
   place: GroupPlace
   /** the ⌘ key that jumps here (first prompt, first loras), null for every other var */
   jumpKey: string | null
}) {
   const rowRef = useRef<HTMLDivElement>(null)
   const jump = p.st.jump
   const jumpKind = p.jumpKey == null ? null : p.v.desc.kind
   useEffect(() => {
      if (jump == null || jumpKind !== 'prompt' || jump.kind !== 'prompt') return
      const editor = rowRef.current?.querySelector<HTMLElement>('.cm-content')
      editor?.focus()
      editor?.scrollIntoView({ block: 'nearest' })
   }, [jump, jumpKind])
   // the workflow's looks (VarUi): every slot optional, absent = the panel's own style. None
   // of them moves anything: a background or a border never shifts the label off its column
   const ui = p.v.desc.ui
   const inactive = p.st.form?.inactiveReason(p.v) ?? null
   const wide = p.v.desc.kind === 'loras' || p.v.desc.kind === 'prompt'
   return (
      <div
         ref={rowRef}
         /* loras and prompts need the whole width on a phone; every other kind keeps its
            label beside the control, which is what makes the form readable at a glance */
         className={`var-row${wide ? ' wide' : ''}${inactive == null ? '' : ' inactive'}${p.place == null ? '' : ` in-group group-${p.place.pos}`}`}
         style={{
            background: ui?.background ?? (p.place == null ? undefined : (p.place.color ?? undefined)),
            outline: ui?.border == null ? undefined : `1px solid ${ui.border}`,
            outlineOffset: ui?.border == null ? undefined : '-1px',
         }}
         onDragOver={(e) => {
            // only a row drag: a file dropped on an image var must still reach its own handler
            if (e.dataTransfer.types.includes('application/x-comfy-var')) e.preventDefault()
         }}
         onDrop={(e) => {
            const raw = e.dataTransfer.getData('application/x-comfy-var')
            if (raw === '') return
            e.preventDefault()
            const from = Number(raw)
            if (Number.isInteger(from) && from !== p.index)
               p.st.moveVar({ module: p.module, names: p.names, from, to: p.index })
         }}
      >
         {/* in the form's left gutter: back to the workflow's default. Always there (disabled at
             the default), so no row moves when a value changes */}
         <button
            type="button"
            className="var-reset"
            disabled={p.v.isAtDefault}
            data-tip={p.v.isAtDefault ? 'at the workflow default' : 'reset to the workflow default'}
            aria-label="reset to the workflow default"
            onClick={() => p.v.resetToDefault()}
         >
            <Icon name="refresh" size={0.95} />
         </button>
         {/* the LABEL is the handle: a separate grip was one more piece of permanent chrome
             for something the label itself can carry */}
         <div
            className={p.jumpKey == null ? 'var-label' : 'var-label has-kbd'}
            draggable
            onDragStart={(e) => {
               e.dataTransfer.effectAllowed = 'move'
               e.dataTransfer.setData('application/x-comfy-var', String(p.index))
            }}
         >
            {/* the kind is a TOOLTIP, not a second line: printed under every label it was a
                column of noise you read past, and it only ever answers a question you ask once */}
            {/* the (?) LEADS: labels are right-aligned against their control, so what trails a
                name is what touches the control, and a help mark there read as part of it */}
            {ui?.description == null ? null : (
               <span className="var-help" data-tip={ui.description}>
                  ?
               </span>
            )}
            {ui?.icon == null ? null : <VarIcon icon={ui.icon} color={ui.color} />}
            <span
               className="var-name"
               data-tip={`${p.v.desc.label ?? p.v.name ?? ''}\n${inactive ?? p.v.desc.kind}\ndrag the label to reorder`}
               style={ui?.labelColor == null ? undefined : { color: ui.labelColor }}
            >
               {p.v.desc.label ?? p.v.name}
            </span>
            {p.v.dirty ? (
               <button
                  type="button"
                  className="dirty-dot"
                  data-tip="changed this session — click to restore the loaded value (autosaves)"
                  onClick={() => p.v.revert()}
               >
                  ●
               </button>
            ) : null}
            {p.jumpKey == null ? null : (
               <span
                  className="var-kbd-line"
                  data-tip={p.v.desc.kind === 'loras' ? 'opens the loras picker' : 'puts the cursor in this prompt'}
               >
                  <span className="kbd-hint">
                     {MOD_KEY}
                     {p.jumpKey}
                  </span>
               </span>
            )}
         </div>
         {/* inert, not just dimmed: a disabled field must not take a click or a keystroke */}
         <div className="var-control" inert={inactive != null}>
            <VarControl v={p.v} host={p.host} st={p.st} module={p.module} jumpTarget={p.jumpKey != null} />
         </div>
      </div>
   )
})

/** the handle on the label column's edge: drag to widen or narrow every label at once */
function LabelResizer(p: { st: WebSt }): ReactNode {
   return (
      <div
         className="label-resizer"
         style={{ left: p.st.labelWidth + 2 }}
         data-tip="drag to resize the label column"
         onPointerDown={(e) => {
            e.preventDefault()
            const startX = e.clientX
            const startW = p.st.labelWidth
            const move = (ev: PointerEvent): void => p.st.setLabelWidth(startW + ev.clientX - startX, false)
            const up = (): void => {
               window.removeEventListener('pointermove', move)
               window.removeEventListener('pointerup', up)
               p.st.setLabelWidth(p.st.labelWidth, true)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
         }}
      />
   )
}

/** everything about running on ONE row: Run with its stop square beside it (red while a run is
 * in progress, grey otherwise), then the two buttons that clear something, each carrying the
 * count it acts on. Every part is always there (disabled when it has nothing to act on), and
 * the counts have tabular digits, so the row never shifts */
export const GenerateButton = observer(function GenerateButton(p: { st: WebSt }) {
   const run = p.st.run
   // the text never changes, so the button never changes size: the progress is a fill sweeping
   // across it, the exact percent is on the running card
   const look = generateButtonLook({ isRunning: run.isRunning, percent: run.progressPercent })
   const pending = runChipText({ kind: 'queue', count: run.pendingCount }).count
   const images = runChipText({ kind: 'results', count: run.results.length }).count
   return (
      <span className="run-bar">
         <span className="btn-group run-split">
            <button
               type="button"
               className={look.running ? 'primary running' : 'primary'}
               data-tip={
                  look.running
                     ? `running ${look.fill ?? 0}%: click again to queue another (⌘⏎ / ctrl+⏎)`
                     : '⌘⏎ / ctrl+⏎: click again to queue another'
               }
               style={
                  look.fill == null
                     ? undefined
                     : {
                          background: `linear-gradient(90deg, var(--accent) ${look.fill}%, var(--accent-dim) ${look.fill}%)`,
                       }
               }
               onClick={() => p.st.generate()}
            >
               <Icon name="play" size={0.85} /> {look.label}
               {/* the shortcut is SAID, not only tooltipped: nobody hovers a button they can click */}
               <span className="kbd-hint">{MOD_KEY}⏎</span>
            </button>
            <button
               type="button"
               className={run.isRunning ? 'run-stop live' : 'run-stop'}
               disabled={!run.isRunning}
               data-tip="stop the run in progress (the queue behind it stays)"
               onClick={() => void p.st.hostAction('interrupt')}
            >
               <Icon name="stop" />
            </button>
         </span>
         <button
            type="button"
            className="run-end"
            disabled={run.pendingCount === 0}
            data-tip={`drop the ${run.pendingCount} prompt(s) not yet sent to the host`}
            onClick={() => run.clearQueue()}
         >
            <Icon name="close" /> Clear <b className="run-num">{pending}</b> queue
         </button>
         <button
            type="button"
            className="run-end"
            disabled={run.results.length === 0}
            data-tip="forget every image shown here (saved files stay on disk)"
            onClick={() => run.clear()}
         >
            <Icon name="trash" /> Erase <b className="run-num">{images}</b> img
         </button>
      </span>
   )
})

/** where the generated images go: the same row shape as a var, because it is one more knob
 * of the run. The toggle and the folder are SERVER settings, so curl sees the same choice */
const SaveRow = observer(function SaveRow(p: { st: WebSt; module: string }) {
   const on = p.st.saveToDisk
   return (
      <div className="var-row">
         <div className="var-label">
            <span data-tip="save — where this workflow's images go">output</span>
         </div>
         <div className="var-control">
            <div className="row-inline">
               <label className="row-inline" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => void p.st.toggleSaveToDisk()} />
                  <span className="hint">
                     <Icon name={on ? 'save' : 'ghost'} size={1} /> {on ? 'write to disk' : 'memory only'}
                  </span>
               </label>
               {on ? (
                  <>
                     <span className="hint">.comfy-ts/outputs/</span>
                     <input
                        type="text"
                        style={{ flex: 1, minWidth: 120 }}
                        placeholder={p.module}
                        value={p.st.savePrefixDraft(p.module)}
                        data-tip="subfolder the images land in — folder names only, a/b allowed"
                        onChange={(e) => p.st.setSavePrefix(p.module, e.target.value)}
                     />
                     <span className="hint">/…png</span>
                  </>
               ) : (
                  <span className="hint">kept in memory and shown here, lost when the server restarts</span>
               )}
            </div>
            {p.st.savingError != null ? <div className="error">🔴 {p.st.savingError}</div> : null}
         </div>
      </div>
   )
})

export const VarsForm = observer(function VarsForm(p: { st: WebSt }) {
   const form = p.st.form
   /** which var each jump lands on, as last rendered: the key handler reads it */
   const targetsRef = useRef<{ prompt: string | null; loras: string | null }>({ prompt: null, loras: null })
   // ⌘⏎ / ctrl+⏎ generates from anywhere, textarea and enhancer included: one key, one meaning
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            // in the enhancer with a rewrite, generate TRIES it; the form keeps its own prompt
            p.st.generate(p.st.enhancer.tryOverride)
            return
         }
         const s = shortcutOf(e)
         // the menu is page layout: App owns that key
         if (s == null || s === 'toggle-menu') return
         // the jumps land in the form, which the enhancer covers: only the blur still makes sense
         if (p.st.enhancer.isOpen && s !== 'toggle-blur') return
         e.preventDefault()
         if (s === 'toggle-blur') return p.st.toggleBlur()
         if (s === 'duplicate-draft') return void p.st.duplicateCurrentDraft()
         if (s === 'rename-draft') return p.st.startRename()
         if (s === 'open-enhancer') {
            const f = p.st.form
            const v = f?.vars.find((x) => x.name === targetsRef.current.prompt)
            // in lanes mode the enhancer opens on the first lane, the one its ✨ sits on
            if (f != null && v != null)
               p.st.enhancer.openFor({ v, module: f.moduleKey, lane: isPromptLanes(v.value) ? 0 : undefined })
            return
         }
         p.st.requestJump(s === 'focus-prompt' ? 'prompt' : 'loras')
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [p.st])
   if (form == null) return null
   // YOUR order (drag), falling back to the workflow's own declaration order
   const orderedNames = p.st.orderedVars(
      form.moduleKey,
      form.vars.map((v) => v.name),
   )
   const orderedVars = orderedNames.map((n) => form.vars.find((v) => v.name === n)).filter((v) => v != null)
   const places = groupPlaces(orderedVars.map((v) => v.desc.ui ?? {}))
   const targets = jumpTargets(
      orderedVars.map((v) => ({ name: v.name, kind: v.desc.kind, inactive: form.inactiveReason(v) != null })),
   )
   targetsRef.current = targets
   const jumpKeyOf = (name: string): string | null =>
      name === targets.prompt
         ? SHORTCUT_KEYS['focus-prompt']
         : name === targets.loras
           ? SHORTCUT_KEYS['open-loras']
           : null
   return (
      <div>
         {/* the autosave state is the draft box's legend now; only a FAILURE gets a line of
             its own, because that one you must not miss */}
         {form.saveState === 'error' ? <div className="error">🔴 draft save failed: {form.saveError}</div> : null}
         {/* ONE grid for every row (rows are subgrids of it). The label column is as wide as YOU
             drag it (kept in this browser): labels never wrap, a cut one shows whole on hover */}
         <div className="vars" style={{ gridTemplateColumns: `${p.st.labelWidth}px minmax(0, 1fr)` }}>
            <LabelResizer st={p.st} />
            {orderedVars.map((v, ix) => (
               // keyed by MODULE and DRAFT: a switch must reset per-row ui state (lora filter,
               // remembered strengths, paused set), not carry the other selection's over.
               // module matters because every workflow has a `default` draft and a `prompt`
               // var, so draft+name alone matches across workflows and react reuses the row
               <VarRow
                  key={`${form.moduleKey}/${form.draft}/${v.name}`}
                  v={v}
                  host={form.host}
                  st={p.st}
                  module={form.moduleKey}
                  index={ix}
                  names={orderedNames}
                  place={places[ix] ?? null}
                  jumpKey={jumpKeyOf(v.name)}
               />
            ))}
            {/* the OUTPUT is a knob like the others: a row, not a lone button in the header */}
            <SaveRow st={p.st} module={form.moduleKey} />
         </div>
         {/* side and pinned put generate INSIDE the results panel, with its error slot; the
             form keeps both otherwise. The error is one reserved line either way, so a failed
             run never adds a bar or pushes anything down */}
         {p.st.generateInResults ? null : (
            <div className="runbar">
               <GenerateButton st={p.st} />
               <span className="run-error" data-tip={p.st.run.error ?? undefined}>
                  {p.st.run.error == null ? '' : `🔴 ${p.st.run.error}`}
               </span>
            </div>
         )}
      </div>
   )
})
