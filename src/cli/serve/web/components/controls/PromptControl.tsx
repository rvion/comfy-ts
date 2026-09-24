// prompt: one box, or `{ lanes }` (src/vars/lanes.ts), one box per named lane merged in listed
// order. Above it, what the active loras add: one line per lora, a popover to leave words out
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import { MenuButton, MenuItem } from 'src/cli/serve/web/components/MenuButton.tsx'
import { PresetPicker } from 'src/cli/serve/web/components/controls/PresetPicker.tsx'
import { PromptEditor } from 'src/cli/serve/web/components/controls/PromptEditor.tsx'
import { PromptEnhancer } from 'src/cli/serve/web/components/PromptEnhancer.tsx'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'
import {
   isPromptLanes,
   moveLane,
   newLaneName,
   patchLane,
   promptFromLanes,
   removeLane,
   toPromptLanes,
   type PromptLane,
} from 'src/vars/lanes.ts'

/** the words each active lora adds in front of the prompt. One line per lora, cut with an
 * ellipsis; clicking opens the full list with a checkbox per word and all / none */
const KeywordGroups = observer(function KeywordGroups(p: { v: VarSt; st: WebSt }) {
   const [open, setOpen] = useState<string | null>(null)
   const form = p.st.form
   const groups = form?.loraKeywordGroups(p.v) ?? []
   if (form == null || groups.length === 0) return null
   return (
      <div className="kw-prefix">
         {groups.map((g) => {
            const kept = g.parts.filter((w) => w.on).length
            return (
               <div key={g.lora} className="preset-box kw-box">
                  <button
                     type="button"
                     className={g.running ? 'kw-line' : 'kw-line stopped'}
                     aria-expanded={open === g.lora}
                     data-tip={`${g.lora}\n${g.running ? 'added in front of your prompt at run time' : 'not running: paused, or its lane is off'}\nclick to choose the words`}
                     onClick={() => setOpen(open === g.lora ? null : g.lora)}
                  >
                     <span className="kw-lora">{g.label}</span>
                     <span className="kw-words">
                        {g.parts
                           .filter((w) => w.on)
                           .map((w) => w.text)
                           .join(', ') || 'no words'}
                     </span>
                     {g.parts.length - kept > 0 ? (
                        <span className="kw-off">+{g.parts.length - kept} disabled</span>
                     ) : null}
                  </button>
                  {open === g.lora ? (
                     <>
                        <div className="preset-backdrop" onClick={() => setOpen(null)} />
                        <div className="preset-menu kw-menu">
                           <div className="row-inline kw-menu-head">
                              <span className="kw-lora">{g.label}</span>
                              <button
                                 type="button"
                                 className="link"
                                 onClick={() => form.setKeywordMute(p.v, g.lora, [])}
                              >
                                 all
                              </button>
                              <button
                                 type="button"
                                 className="link"
                                 onClick={() =>
                                    form.setKeywordMute(
                                       p.v,
                                       g.lora,
                                       g.parts.map((w) => w.text),
                                    )
                                 }
                              >
                                 none
                              </button>
                           </div>
                           {g.parts.map((w) => (
                              <label key={w.text} className="kw-item">
                                 <input
                                    type="checkbox"
                                    checked={w.on}
                                    onChange={() => form.toggleKeywordPart(p.v, g.lora, w.text)}
                                 />
                                 <span>{w.text}</span>
                              </label>
                           ))}
                        </div>
                     </>
                  ) : null}
               </div>
            )
         })}
      </div>
   )
})

const LANE_DRAG = 'application/x-comfy-lane'

/** one prompt lane: a name pill and its box. Click the pill to use or leave out the lane, drag
 * it onto another lane to reorder, ⋯ to rename or remove. Nothing else on the bar */
const LaneBox = observer(function LaneBox(p: { v: VarSt; st: WebSt; module: string; lanes: PromptLane[]; ix: number }) {
   const [renaming, setRenaming] = useState(false)
   const lane = p.lanes[p.ix]
   if (lane == null) return null
   const write = (lanes: PromptLane[]): void => {
      p.v.set({ lanes })
   }
   return (
      <div
         className={lane.active ? 'lane-box' : 'lane-box off'}
         onDragOver={(e) => {
            if (e.dataTransfer.types.includes(LANE_DRAG)) e.preventDefault()
         }}
         onDrop={(e) => {
            const from = Number(e.dataTransfer.getData(LANE_DRAG))
            if (e.dataTransfer.getData(LANE_DRAG) === '' || !Number.isInteger(from) || from === p.ix) return
            e.preventDefault()
            write(moveLane(p.lanes, from, p.ix - from))
         }}
      >
         <div className="lane-bar">
            {renaming ? (
               <input
                  type="text"
                  className="lane-name"
                  autoFocus
                  defaultValue={lane.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                     if (e.key === 'Enter') {
                        write(patchLane(p.lanes, p.ix, { name: e.currentTarget.value.trim() || lane.name }))
                        setRenaming(false)
                     }
                     if (e.key === 'Escape') setRenaming(false)
                  }}
                  onBlur={() => setRenaming(false)}
               />
            ) : (
               <button
                  type="button"
                  className={lane.active ? 'lane-pill' : 'lane-pill off'}
                  draggable
                  data-tip={`${lane.active ? 'in the prompt' : 'left out'}: click to switch, drag to reorder, double-click to rename`}
                  onDragStart={(e) => {
                     e.dataTransfer.effectAllowed = 'move'
                     e.dataTransfer.setData(LANE_DRAG, String(p.ix))
                  }}
                  onClick={() => write(patchLane(p.lanes, p.ix, { active: !lane.active }))}
                  onDoubleClick={() => setRenaming(true)}
               >
                  {lane.name}
               </button>
            )}
            <span className="lane-tools">
               <PromptEnhancer v={p.v} st={p.st} module={p.module} lane={p.ix} compact />
               <MenuButton tip="lane actions">
                  {(close) => (
                     <>
                        <MenuItem
                           label="rename"
                           onClick={() => {
                              close()
                              setRenaming(true)
                           }}
                        />
                        <MenuItem
                           label="remove"
                           disabled={p.lanes.length === 1}
                           onClick={() => {
                              close()
                              write(removeLane(p.lanes, p.ix))
                           }}
                        />
                     </>
                  )}
               </MenuButton>
            </span>
         </div>
         <PromptEditor
            v={p.v}
            st={p.st}
            module={p.module}
            value={lane.prompt}
            onChange={(text) => write(patchLane(p.lanes, p.ix, { prompt: text }))}
            minLines={2}
         />
      </div>
   )
})

export const PromptControl = observer(function PromptControl(p: { v: VarSt; st: WebSt; module: string }) {
   const value = p.v.value
   if (isPromptLanes(value)) {
      const single = promptFromLanes(value)
      return (
         <div>
            <KeywordGroups v={p.v} st={p.st} />
            <div className="lanes">
               {value.lanes.map((lane, ix) => (
                  // index keys on purpose: a lane's name is editable and may repeat
                  <LaneBox key={ix} v={p.v} st={p.st} module={p.module} lanes={value.lanes} ix={ix} />
               ))}
            </div>
            <div className="row-inline lane-foot">
               <button
                  type="button"
                  className="link"
                  onClick={() =>
                     p.v.set({
                        lanes: [...value.lanes, { name: newLaneName(value.lanes), prompt: '', active: true }],
                     })
                  }
               >
                  + lane
               </button>
               {single == null ? null : (
                  <button
                     type="button"
                     className="link"
                     data-tip="back to a single prompt box"
                     onClick={() => p.v.set(single)}
                  >
                     single box
                  </button>
               )}
               <span className="hint">lanes merge top to bottom</span>
            </div>
         </div>
      )
   }
   const text = typeof value === 'string' ? value : ''
   return (
      <div>
         <KeywordGroups v={p.v} st={p.st} />
         <PromptEditor v={p.v} st={p.st} module={p.module} value={text} onChange={(t) => p.v.set(t)} minLines={4} />
         {/* three small separate actions under the box, the same size, none dressed as a link */}
         <div className="row-inline prompt-actions">
            <PresetPicker v={p.v} />
            <PromptEnhancer v={p.v} st={p.st} module={p.module} />
            <button
               type="button"
               className="mini"
               data-tip="split this prompt into named lanes, merged in the order they are listed"
               onClick={() => p.v.set(toPromptLanes(text))}
            >
               lanes
            </button>
         </div>
      </div>
   )
})
