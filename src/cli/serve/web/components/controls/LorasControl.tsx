// loras as a PALETTE. The row shows only the loras you put in it; clicking a
// card PAUSES or RESUMES it in place, so you can run a few images with a lora
// and a few without, never reopening the popup to add it back. Model/clip
// strengths sit on the card too. The popup is the only place that lists ALL
// loras: tap one there to add it to the palette, ✕ on a card removes it.
// the PALETTE is derived, never read off the draft: loras that are ON, plus the
// ones paused in this session. Reading "every key in the record" was the bug —
// LorasVar writes `false` for every lora ever unticked, so a real draft with 35
// keys and 2 on showed all 35. A pause removes the key (and remembers the
// strength), so a draft only ever lists what is actually on. The 🖼/🏷
// toggles hide images/titles on every lora surface (NSFW screens, persisted on
// WebSt); with both hidden the row collapses to a count. Names come from
// descriptor optionLabels; the value keeps raw enum keys, replaced by copy
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { MenuButton, MenuItem } from 'src/cli/serve/web/components/MenuButton.tsx'
import { logWebError } from 'src/cli/serve/web/logWeb.ts'
import { observer, useLocalObservable } from 'mobx-react-lite'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { fetchLoraAbout, fetchLoraInfo, loraPreviewSrc, type LoraAbout, type LoraInfo } from 'src/cli/serve/web/api.ts'
import type { LoraStrength } from 'src/vars/loraEntry.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'
import { LORA_SORTS, sortLoraMatches } from 'src/cli/serve/web/state/loraSort.ts'
import {
   loraIsOn,
   paletteOrder,
   pruneLorasRecord,
   reorderLoras,
   loraStrengthPair,
   setLoraEnabled,
   setLoraStrength,
   type LoraStrengthPair,
} from 'src/cli/serve/web/state/payload.ts'
import {
   isLoraLanes,
   isLorasInput,
   lorasFromLanes,
   moveLane,
   moveLoraToLane,
   newLaneName,
   patchLane,
   removeLane,
   toLoraLanes,
   type LoraLane,
   type LoraRecord,
   type LorasInput,
} from 'src/vars/lanes.ts'

/** one editable list of loras: the whole var, or one of its lanes (ix -1 = no lanes) */
type Section = { ix: number; record: LoraRecord; lane: LoraLane | null }

/** our own drag payload type: a foreign drag cannot forge it */
const CARD_DRAG_TYPE = 'application/x-comfy-lora'

type LocalSt = {
   open: boolean
   filter: string
   info: Map<string, LoraInfo | 'loading' | 'error'>
   previewFailed: Set<string>
   setOpen(open: boolean): void
   /** the section the popup adds into (-1 = the var itself, no lanes) */
   target: number
   openFor(ix: number): void
   setFilter(raw: string): void
   noteInfo(name: string, v: LoraInfo | 'loading' | 'error'): void
   notePreviewFailed(name: string): void
   /** the lora whose details panel is open, null when none */
   details: string | null
   setDetails(name: string | null): void
   /** model and clip shown APART, per lora. Absent = follow whether they already differ */
   split: Map<string, boolean>
   isSplit(name: string, whenUnset: boolean): boolean
   setSplit(name: string, split: boolean): void
}

const LANE_DRAG = 'application/x-comfy-lora-lane'

/** a lora lane's bar: a name pill (click = use / leave out, drag = reorder, double-click =
 * rename), the count, and ⋯. It also takes a card dropped on it: the lora moves to its end */
const LoraLaneBar = observer(function LoraLaneBar(p: {
   v: VarSt
   lanes: LoraLane[]
   ix: number
   count: number
   on: number
   onDropCard: (raw: string) => void
}) {
   const [renaming, setRenaming] = useState(false)
   const lane = p.lanes[p.ix]
   if (lane == null) return null
   const write = (lanes: LoraLane[]): void => {
      p.v.set({ lanes })
   }
   return (
      <div
         className="lane-bar"
         onDragOver={(e) => {
            const types = e.dataTransfer.types
            if (types.includes(CARD_DRAG_TYPE) || types.includes(LANE_DRAG)) e.preventDefault()
         }}
         onDrop={(e) => {
            const card = e.dataTransfer.getData(CARD_DRAG_TYPE)
            if (card !== '') {
               e.preventDefault()
               p.onDropCard(card)
               return
            }
            const raw = e.dataTransfer.getData(LANE_DRAG)
            const from = Number(raw)
            if (raw === '' || !Number.isInteger(from) || from === p.ix) return
            e.preventDefault()
            write(moveLane(p.lanes, from, p.ix - from))
         }}
      >
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
               data-tip={`${lane.active ? 'runs' : 'left out'}: click to switch, drag to reorder, double-click to rename`}
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
         {p.count === 0 ? null : <span className="hint">{`${p.on}/${p.count} on`}</span>}
         <span className="lane-tools">
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
                        disabled={p.count > 0 || p.lanes.length === 1}
                        tip={p.count > 0 ? 'empty the lane first' : undefined}
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
   )
})

export const LorasControl = observer(function LorasControl(p: {
   v: VarSt
   host: string
   st: WebSt
   hostUrl: string | null
}) {
   const local = useLocalObservable<LocalSt>(() => ({
      open: false,
      filter: '',
      info: new Map(),
      previewFailed: new Set(),
      paused: new Set(),
      target: -1,
      openFor(ix: number) {
         this.target = ix
         this.open = true
      },
      setOpen(open: boolean) {
         this.open = open
      },
      setFilter(raw: string) {
         this.filter = raw
      },
      noteInfo(name: string, v: LoraInfo | 'loading' | 'error') {
         this.info.set(name, v)
      },
      notePreviewFailed(name: string) {
         this.previewFailed.add(name)
      },
      details: null,
      setDetails(name: string | null) {
         this.details = name
      },
      split: new Map(),
      isSplit(name: string, whenUnset: boolean) {
         return this.split.get(name) ?? whenUnset
      },
      setSplit(name: string, split: boolean) {
         this.split.set(name, split)
      },
   }))
   const value: LorasInput = isLorasInput(p.v.value) ? p.v.value : {}
   const laned = isLoraLanes(value) ? value : null
   const options = p.v.desc.options ?? []
   const labels = p.v.desc.optionLabels ?? {}
   const label = (name: string): string => labels[name] ?? name
   // the row is a list of SECTIONS: one per lane (src/vars/lanes.ts), or a single one without
   // lanes. A section's palette is its loras that are on plus the paused ones, never "every key":
   // `false` is what an untick in the TUI writes, and reading it as a member put the whole
   // catalog in the row. Record order inside a section, so a lora you add lands at the END
   const sections: Section[] = isLoraLanes(value)
      ? value.lanes.map((lane, ix) => ({ ix, record: lane.loras, lane }))
      : [{ ix: -1, record: value, lane: null }]
   const namesOf = (sec: Section): string[] => paletteOrder({ record: sec.record, options })
   const allNames = [...new Set(sections.flatMap(namesOf))]
   const isOn = (sec: Section, name: string): boolean => loraIsOn(sec.record[name])
   const onCount = sections.reduce((n, sec) => n + namesOf(sec).filter((name) => isOn(sec, name)).length, 0)
   // the popup adds into ONE section: the lane whose `add` opened it
   const target = sections.find((sec) => sec.ix === local.target) ?? sections[0] ?? null
   const targetNames = target == null ? [] : namesOf(target)
   /** write one section back: the var itself, or its lane. Pruned through the same typed filter
    * a loaded draft goes through, so what lands in the var is always a valid record */
   const writeSection = (ix: number, record: Record<string, unknown>): void => {
      const clean = pruneLorasRecord(record, options)
      if (laned == null) p.v.set(clean)
      else p.v.set({ lanes: patchLane(laned.lanes, ix, { loras: clean }) })
   }
   /** known to the lora manager, absent from ComfyUI's own enum. it is offered rather than
    * hidden, but ComfyUI validates a prompt against the enum it has CACHED, so picking one
    * fails at send time until that host rescans its models. ComfyUI rescans a folder when its
    * mtime moves, which never happens on exFAT: extra/comfyui-fresh-model-lists fixes that */
   const managerOnly = new Set(p.v.desc.managerOnlyOptions ?? [])
   const MANAGER_ONLY_TIP =
      "on disk and known to the lora manager, but not in ComfyUI's list yet: it refuses the prompt. the panel refreshes the host by itself when it changes; if this stays, the models drive is probably exFAT (install extra/comfyui-fresh-model-lists) or ComfyUI needs a restart"
   const warnBadge = (name: string): ReactNode =>
      managerOnly.has(name) ? (
         <span className="lora-warn" data-tip={MANAGER_ONLY_TIP}>
            <Icon name="warn" size={0.9} />
         </span>
      ) : null
   const showImages = p.st.showLoraImages
   const triggers = p.v.desc.optionTriggers ?? {}
   /** the trigger words under a row card, in one of FOUR states that never look alike: the
    * words, a definite none (civitai was asked), never fetched (a button asks it), or not loaded
    * yet (the local copy of the manager's list predates the lora, a button re-reads it). Titles hidden hides the words, never the state */
   const triggerLine = (name: string): ReactNode => {
      const t = triggers[name]
      if (t == null)
         return (
            <span
               className="chip-triggers missing"
               data-tip="this lora is newer than the copy of the lora manager's list kept here: the next host refresh brings its trigger words, name and preview (it runs by itself). The lora itself runs fine"
            >
               trigger words not loaded yet
            </span>
         )
      if (t.state === 'unfetched') {
         const busy = p.st.loraFetching.has(name)
         return (
            <span className="chip-triggers missing">
               trigger words never fetched
               <button
                  type="button"
                  className="trigger-fetch"
                  disabled={busy}
                  data-tip="ask the lora manager to fetch this lora's civitai metadata, trigger words included"
                  onClick={() => void p.st.fetchLoraTriggers(name)}
               >
                  {busy ? 'fetching…' : 'fetch'}
               </button>
            </span>
         )
      }
      if (t.state === 'not-on-civitai') {
         const busy = p.st.loraFetching.has(name)
         return (
            <span
               className="chip-triggers missing"
               data-tip="civitai was asked and has no version for this file: a private or local lora, so no trigger words exist there"
            >
               not on civitai
               <button
                  type="button"
                  className="trigger-fetch"
                  disabled={busy}
                  data-tip="ask civitai again (it may have been published since)"
                  onClick={() => void p.st.fetchLoraTriggers(name)}
               >
                  {busy ? 'asking…' : 'retry'}
               </button>
            </span>
         )
      }
      if (t.state === 'none')
         return (
            <span className="chip-triggers none" data-tip="civitai was asked, and this lora has no trigger words">
               no trigger words
            </span>
         )
      return (
         <span className="chip-triggers words" data-tip={showTitles ? t.words.join('\n') : 'titles are hidden'}>
            {showTitles ? t.words.join(', ') : `${t.words.length} trigger word${t.words.length === 1 ? '' : 's'}`}
         </span>
      )
   }
   const showTitles = p.st.showLoraTitles

   /** add to a section (a strength) or REMOVE from it entirely (null) */
   const setEntry = (sec: Section, name: string, st: LoraStrength | null): void => {
      const next: Record<string, unknown> = { ...sec.record }
      if (st == null) delete next[name]
      else next[name] = st
      writeSection(sec.ix, next)
   }
   // a pause keeps the key and its strengths in the draft, so a reload keeps it off
   const toggleOn = (sec: Section, name: string, on: boolean): void => {
      writeSection(sec.ix, setLoraEnabled(sec.record, name, on))
   }
   const setStrength = (sec: Section, name: string, pair: LoraStrengthPair): void => {
      writeSection(sec.ix, setLoraStrength(sec.record, name, pair))
   }

   /** ONE slider by default, labelled `m+c`: model and clip are the same number in almost every
    * lora, and two sliders for one decision is noise. Clicking the label splits them, and a lora
    * whose values already differ opens split, its setting is someone's work, not a default */
   const strengthInputs = (sec: Section, name: string): ReactNode => {
      const pair = loraStrengthPair(sec.record[name])
      const split = local.isSplit(name, pair.model !== pair.clip)
      const write = (which: 'model' | 'clip' | 'both', raw: number): void => {
         if (!Number.isFinite(raw)) return
         const n = Math.round(raw * 100) / 100
         if (which === 'both') return setStrength(sec, name, { model: n, clip: n })
         setStrength(sec, name, which === 'model' ? { model: n, clip: pair.clip } : { model: pair.model, clip: n })
      }
      const line = (which: 'model' | 'clip' | 'both', value: number, text: string, tip: string): ReactNode => (
         <div className="st-line">
            <button type="button" className="st-label" data-tip={tip} onClick={() => local.setSplit(name, !split)}>
               {text}
            </button>
            <input
               type="range"
               min={-1}
               max={2}
               step={0.05}
               value={value}
               onChange={(e) => write(which, parseFloat(e.target.value))}
            />
            <input type="number" step={0.05} value={value} onChange={(e) => write(which, parseFloat(e.target.value))} />
         </div>
      )
      if (!split) return line('both', pair.model, 'm+c', 'model and clip together — click to set them apart')
      return (
         <>
            {line('model', pair.model, 'm', 'model strength — click to tie them back together')}
            {line('clip', pair.clip, 'c', 'clip strength — click to tie them back together')}
         </>
      )
   }

   // trigger words for the active section load once per open (bounded: active loras only)
   const open = local.open
   const host = p.host
   const activeKey = allNames.join('\n')
   useEffect(() => {
      if (!open) return
      for (const name of activeKey.split('\n')) {
         if (name === '' || local.info.has(name)) continue
         local.noteInfo(name, 'loading')
         fetchLoraInfo({ host, name })
            .then((i) => local.noteInfo(name, i))
            .catch(() => local.noteInfo(name, 'error'))
      }
   }, [open, activeKey, host, local])

   // esc closes wherever focus is, not only inside the filter input
   useEffect(() => {
      if (!open) return
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Escape') local.setOpen(false)
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [open, local])

   const needle = local.filter.toLowerCase()
   const matchesFilter = (name: string): boolean =>
      name.toLowerCase().includes(needle) || label(name).toLowerCase().includes(needle)
   const matches = sortLoraMatches({
      names: options.filter(matchesFilter),
      mode: p.st.loraSort,
      label,
      addedAt: p.v.desc.optionAddedAt ?? {},
   })
   const cardCap = p.st.loraCap
   const cards = matches.filter((o) => !targetNames.includes(o)).slice(0, cardCap)
   /** the enum value IS a path (`krea2\styles\x.safetensors`, separators vary by host and by
    * where the name came from), so the folder is everything before the last separator */
   const folderOf = (name: string): string => {
      const parts = name.split(/[\\/]+/)
      return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
   }
   const groupedCards = (() => {
      if (p.st.loraSort !== 'folder') return [{ folder: null, names: cards }]
      const byFolder = new Map<string, string[]>()
      for (const name of cards) {
         const folder = folderOf(name)
         const list = byFolder.get(folder)
         if (list == null) byFolder.set(folder, [name])
         else list.push(name)
      }
      return [...byFolder.entries()]
         .map(([folder, names]) => ({ folder, names }))
         .sort((a, b) => a.folder.localeCompare(b.folder))
   })()

   // opening the popup puts you IN the filter with the previous needle SELECTED, so typing
   // replaces it instead of appending to it (the field keeps its text between opens)
   const filterRef = useRef<HTMLInputElement>(null)
   useEffect(() => {
      if (!open) return
      const input = filterRef.current
      if (input == null) return
      input.focus()
      input.select()
   }, [open])

   /** enter takes the FIRST card, the one the eye lands on. The popup stays open with the
    * needle reselected, so adding three loras is type-enter-type-enter, and the new entry
    * is visible at once in the palette section above */
   const addFirstMatch = (): void => {
      const first = cards[0]
      if (first == null) return
      // the SAME call the card's own click makes, so enter and a tap cannot drift apart
      if (target != null) setEntry(target, first, [1, 1])
      filterRef.current?.select()
   }

   // ONE size factor for every lora image (the slider): the palette card, its image, and the
   // popup's grid all follow it. 168/130 and 120/110 are the base card and image sizes
   const scale = p.st.loraScale
   const cardWidth = Math.round(168 * scale)
   const gridMin = Math.round(120 * scale)
   const thumb = (name: string, height?: number): ReactNode => {
      if (!showImages) return null
      const style = height == null ? undefined : { height }
      return local.previewFailed.has(name) ? (
         <div className="lora-thumb none" style={style}>
            no preview
         </div>
      ) : (
         <img
            key={name}
            style={style}
            className={p.st.loraFill ? 'lora-thumb fill' : 'lora-thumb'}
            loading="lazy"
            src={loraPreviewSrc({ host: p.host, name })}
            alt={label(name)}
            onError={() => local.notePreviewFailed(name)}
         />
      )
   }

   /** the image size, a small slider: only while images are shown */
   const sizeSlider = showImages ? (
      <input
         type="range"
         className="lora-size"
         min={0.6}
         max={2}
         step={0.05}
         value={scale}
         data-tip={`lora image size ×${scale.toFixed(2)}`}
         onChange={(e) => p.st.setLoraScale(parseFloat(e.target.value))}
      />
   ) : null

   const visibilityToggles = (
      <>
         <button
            type="button"
            className={showImages ? 'mode sel' : 'mode'}
            data-tip={showImages ? 'hide lora images' : 'show lora images'}
            onClick={() => p.st.toggleLoraImages()}
         >
            <Icon name="image" />
         </button>
         <button
            type="button"
            className={showTitles ? 'mode sel' : 'mode'}
            data-tip={showTitles ? 'hide lora titles' : 'show lora titles'}
            onClick={() => p.st.toggleLoraTitles()}
         >
            <Icon name="tag" />
         </button>
         <button
            type="button"
            className={p.st.showLoraTriggers ? 'mode sel' : 'mode'}
            data-tip={p.st.showLoraTriggers ? 'hide the trigger words' : 'show the trigger words'}
            onClick={() => p.st.toggleLoraTriggers()}
         >
            <Icon name="text" />
         </button>
         {/* cover vs contain: a style lora's art crops beautifully and a character sheet does
             not, so which one is right is per collection, not something to decide here */}
         {showImages ? (
            <button
               type="button"
               className={p.st.loraFill ? 'mode sel' : 'mode'}
               data-tip={p.st.loraFill ? 'fit the whole preview inside the card' : 'fill the card with the preview'}
               onClick={() => p.st.toggleLoraFill()}
            >
               <Icon name={p.st.loraFill ? 'shrink' : 'expand'} />
            </button>
         ) : null}
      </>
   )

   return (
      <div>
         {/* the controls sit ABOVE the palette, left aligned: after a row of cards they read as
             an afterthought, and a centred trio of buttons has nothing to align with */}
         <div className="lora-actions">
            <button type="button" className="field-height accent" onClick={() => local.openFor(sections[0]?.ix ?? -1)}>
               <Icon name="plus" /> add
            </button>
            {/* everything used now and then lives behind ⋯: the row shows loras, not a strip
                of buttons. The rescan warning stays out, it asks for action */}
            <MenuButton tip="display, lora manager, lanes">
               {(close) => (
                  <>
                     <MenuItem label="images" checked={showImages} onClick={() => p.st.toggleLoraImages()} />
                     <MenuItem label="titles" checked={showTitles} onClick={() => p.st.toggleLoraTitles()} />
                     <MenuItem
                        label="fill the card"
                        checked={p.st.loraFill}
                        disabled={!showImages}
                        onClick={() => p.st.toggleLoraFill()}
                     />
                     <MenuItem
                        label="trigger words"
                        checked={p.st.showLoraTriggers}
                        onClick={() => p.st.toggleLoraTriggers()}
                     />
                     {/* a display setting, not a control of the var: it lives in the menu */}
                     {showImages ? (
                        <label className="menu-item menu-range">
                           <span className="menu-check" />
                           size
                           {sizeSlider}
                        </label>
                     ) : null}
                     <div className="menu-sep" />
                     {p.hostUrl == null ? null : (
                        <MenuItem
                           label="open the lora manager ↗"
                           onClick={() => {
                              close()
                              window.open(`${p.hostUrl}/loras`, '_blank', 'noreferrer')
                           }}
                        />
                     )}
                     <div className="menu-sep" />
                     {/* lanes: named groups merged top to bottom. Back to one row only when that
                         loses nothing, a single active lane */}
                     {laned == null ? (
                        <MenuItem
                           label="split into lanes"
                           onClick={() => {
                              close()
                              p.v.set(toLoraLanes(value))
                           }}
                        />
                     ) : (
                        <>
                           <MenuItem
                              label="+ lane"
                              onClick={() => {
                                 close()
                                 p.v.set({
                                    lanes: [
                                       ...laned.lanes,
                                       { name: newLaneName(laned.lanes), active: true, loras: {} },
                                    ],
                                 })
                              }}
                           />
                           <MenuItem
                              label="back to a single row"
                              disabled={lorasFromLanes(laned) == null}
                              tip={
                                 lorasFromLanes(laned) == null
                                    ? 'only with one active lane: nothing gets merged behind your back'
                                    : undefined
                              }
                              onClick={() => {
                                 close()
                                 const single = lorasFromLanes(laned)
                                 if (single != null) p.v.set(single)
                              }}
                           />
                        </>
                     )}
                  </>
               )}
            </MenuButton>
            {allNames.length > 0 ? (
               <span className="hint">
                  {allNames.length} in the palette · {onCount} on
               </span>
            ) : null}
         </div>
         <div className="lora-lanes">
            {!showImages && !showTitles ? (
               <span className="hint">
                  {allNames.length} lora{allNames.length === 1 ? '' : 's'} in the palette
               </span>
            ) : (
               sections.map((sec) => {
                  const names = namesOf(sec)
                  /** a card or a lane header takes a dropped card: same lane = reorder, another
                   * lane = the lora moves there, before `beforeName` or last */
                  const dropHere = (raw: string, beforeName: string | null): void => {
                     const [fromRaw, fromName] = raw.split('\n')
                     const from = Number(fromRaw)
                     if (fromName == null || !Number.isInteger(from) || fromName === beforeName) return
                     if (from === sec.ix) {
                        const to = beforeName == null ? names.length - 1 : names.indexOf(beforeName)
                        const at = names.indexOf(fromName)
                        if (at === -1 || to === -1) return
                        writeSection(sec.ix, reorderLoras({ record: sec.record, displayed: names, from: at, to }))
                     } else if (laned != null)
                        p.v.set(
                           moveLoraToLane(laned, {
                              from,
                              name: fromName,
                              to: sec.ix,
                              beforeName: beforeName ?? undefined,
                           }),
                        )
                  }
                  const acceptDrag = (e: DragEvent): void => {
                     if (e.dataTransfer.types.includes(CARD_DRAG_TYPE)) e.preventDefault()
                  }
                  return (
                     <div
                        key={sec.ix}
                        className={`lora-section${sec.lane == null ? '' : ' laned'}${sec.lane == null || sec.lane.active ? '' : ' off'}`}
                     >
                        {sec.lane == null || laned == null ? null : (
                           <LoraLaneBar
                              v={p.v}
                              lanes={laned.lanes}
                              ix={sec.ix}
                              count={names.length}
                              on={names.filter((n) => isOn(sec, n)).length}
                              onDropCard={(raw) => dropHere(raw, null)}
                           />
                        )}
                        <div className="row-inline lora-lane">
                           {names.map((name) => (
                              <span
                                 key={name}
                                 className={`${showImages ? 'lora-chip card' : 'lora-chip'}${isOn(sec, name) ? '' : ' off'}`}
                                 style={showImages ? { width: cardWidth } : undefined}
                                 draggable
                                 onMouseDown={(e) => {
                                    // the WHOLE card drags, so the browser hands it the pointer before any
                                    // control below sees it, and a slider drag would only reorder the card.
                                    // disarm for this gesture when it starts on an input: recomputed on every
                                    // mousedown, so there is no armed/disarmed state to leak
                                    const from = e.target as HTMLElement
                                    // buttons too (✕, the m+c label): a press that drifts a pixel would
                                    // otherwise start a reorder instead of firing the click
                                    e.currentTarget.draggable = from.closest('input, label, button, select, a') == null
                                 }}
                                 // re-arm once the gesture is over, so the grab cursor comes back the
                                 // moment you leave the slider
                                 onMouseUp={(e) => {
                                    e.currentTarget.draggable = true
                                 }}
                                 onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = 'move'
                                    // the lane and the name travel in the drag itself: no drag state to leak
                                    e.dataTransfer.setData(CARD_DRAG_TYPE, `${sec.ix}\n${name}`)
                                 }}
                                 // only OUR drag: a desktop file or a var row carries no payload
                                 onDragOver={acceptDrag}
                                 onDrop={(e) => {
                                    const raw = e.dataTransfer.getData(CARD_DRAG_TYPE)
                                    if (raw === '') return
                                    e.preventDefault()
                                    dropHere(raw, name)
                                 }}
                              >
                                 {/* the ✕ is a child of the PICTURE's own box, never of the card: its
                                     containing block is then this wrapper whatever else is positioned
                                     around it, so it cannot take a row of flow nor escape the card */}
                                 <span className="chip-media">
                                    {/* the CARD opens what this lora is; only the switch turns it on and off,
                                        so reading about a lora can never change what the graph runs */}
                                    <button
                                       type="button"
                                       className="lora-toggle"
                                       data-tip={`${name}\nclick for its details`}
                                       onClick={() => local.setDetails(name)}
                                    >
                                       {thumb(name, Math.round(130 * scale))}
                                    </button>
                                    <button
                                       type="button"
                                       className="chip-remove"
                                       data-tip="remove from the palette (the popup adds it back)"
                                       onClick={() => setEntry(sec, name, null)}
                                    >
                                       <Icon name="close" size={1.05} />
                                    </button>
                                 </span>
                                 {/* the switch sits WITH the title: state and name read as one line */}
                                 <span className="chip-head">
                                    <label
                                       className="switch"
                                       data-tip={isOn(sec, name) ? 'pause this lora' : 'resume this lora'}
                                    >
                                       <input
                                          type="checkbox"
                                          checked={isOn(sec, name)}
                                          onChange={(e) => toggleOn(sec, name, e.target.checked)}
                                       />
                                       <span className="track" />
                                    </label>
                                    {showTitles ? (
                                       <button
                                          type="button"
                                          className="chip-title as-text"
                                          data-tip={`${name}\nclick for its details`}
                                          onClick={() => local.setDetails(name)}
                                       >
                                          {label(name)}
                                       </button>
                                    ) : null}
                                    {warnBadge(name)}
                                 </span>
                                 <span className="chip-controls">{strengthInputs(sec, name)}</span>
                                 {p.st.showLoraTriggers ? triggerLine(name) : null}
                              </span>
                           ))}
                           {/* a lane adds at its own end: a dashed card, no header button */}
                           {sec.lane == null ? null : (
                              <button
                                 type="button"
                                 className="lora-add-card"
                                 data-tip={`add loras to ${sec.lane.name}`}
                                 onDragOver={acceptDrag}
                                 onDrop={(e) => {
                                    const raw = e.dataTransfer.getData(CARD_DRAG_TYPE)
                                    if (raw === '') return
                                    e.preventDefault()
                                    dropHere(raw, null)
                                 }}
                                 onClick={() => local.openFor(sec.ix)}
                              >
                                 <Icon name="plus" />
                              </button>
                           )}
                        </div>
                     </div>
                  )
               })
            )}
            {laned == null ? null : (
               <div className="row-inline">
                  <button
                     type="button"
                     onClick={() =>
                        p.v.set({
                           lanes: [...laned.lanes, { name: newLaneName(laned.lanes), active: true, loras: {} }],
                        })
                     }
                  >
                     <Icon name="plus" /> lane
                  </button>
                  <span className="hint">lanes merge top to bottom · drag a card onto another lane to move it</span>
               </div>
            )}
         </div>

         {local.details == null ? null : (
            <LoraDetails
               name={local.details}
               host={p.host}
               hostUrl={p.hostUrl}
               label={label(local.details)}
               showImage={showImages}
               keyword={(p.v.desc.optionKeywords ?? {})[local.details] ?? null}
               managerOnly={managerOnly.has(local.details)}
               onClose={() => local.setDetails(null)}
            />
         )}
         {local.open ? (
            // anchored near the TOP at a fixed height: filtering or hiding images changes what is
            // inside, never where the popup sits
            <div className="modal-overlay top" onClick={() => local.setOpen(false)}>
               <div className="modal loras-modal" onClick={(e) => e.stopPropagation()}>
                  {/* the display toggles first, the search in the middle, close alone at the end */}
                  <div className="modal-head">
                     <span className="btn-group">{visibilityToggles}</span>
                     {sizeSlider}
                     <input
                        ref={filterRef}
                        type="text"
                        placeholder={`search ${options.length} loras, enter adds the first`}
                        value={local.filter}
                        onChange={(e) => local.setFilter(e.target.value)}
                        onKeyDown={(e) => {
                           if (e.key !== 'Enter') return
                           e.preventDefault()
                           addFirstMatch()
                        }}
                     />
                     <button
                        type="button"
                        className="modal-close"
                        data-tip="close (esc)"
                        onClick={() => local.setOpen(false)}
                     >
                        <Icon name="close" />
                     </button>
                  </div>
                  <div className="modal-body">
                     {target != null && targetNames.length > 0 ? (
                        <div>
                           <div className="section-title">
                              {target.lane == null ? 'your palette' : `lane ${target.lane.name}`} ({targetNames.length})
                           </div>
                           {targetNames.filter(matchesFilter).map((name) => {
                              const info = local.info.get(name)
                              return (
                                 <div
                                    key={name}
                                    className={isOn(target, name) ? 'lora-active-row' : 'lora-active-row off'}
                                 >
                                    {thumb(name)}
                                    <div className="lora-active-text">
                                       <div className="lora-label" data-tip={name}>
                                          {showTitles ? label(name) : '···'}
                                       </div>
                                       {p.st.showLoraTriggers &&
                                       typeof info === 'object' &&
                                       info.triggerWords.length > 0 ? (
                                          <div className="hint">{info.triggerWords.join(', ')}</div>
                                       ) : (
                                          <div className="hint">{name}</div>
                                       )}
                                    </div>
                                    <input
                                       type="checkbox"
                                       checked={isOn(target, name)}
                                       data-tip={isOn(target, name) ? 'pause (stays in the palette)' : 'resume'}
                                       onChange={(e) => toggleOn(target, name, e.target.checked)}
                                    />
                                    {strengthInputs(target, name)}
                                    <button
                                       type="button"
                                       className="chip-remove"
                                       data-tip="remove from the list"
                                       onClick={() => setEntry(target, name, null)}
                                    >
                                       <Icon name="close" size={0.9} />
                                    </button>
                                 </div>
                              )
                           })}
                        </div>
                     ) : null}
                     <div className="section-title lora-sort-head">
                        all loras — tap to add to the palette
                        <span className="lora-sort">
                           sort
                           {LORA_SORTS.map((s) => (
                              <button
                                 key={s.mode}
                                 type="button"
                                 className={p.st.loraSort === s.mode ? 'mode sel' : 'mode'}
                                 data-tip={s.tip}
                                 onClick={() => p.st.setLoraSort(s.mode)}
                              >
                                 {s.label}
                              </button>
                           ))}
                        </span>
                     </div>
                     {groupedCards.map((group) => (
                        <div key={group.folder ?? '*'}>
                           {group.folder == null ? null : (
                              <div className="section-title">
                                 {group.folder === '' ? 'loose (no folder)' : `${group.folder}/`} · {group.names.length}
                              </div>
                           )}
                           <div
                              className="lora-grid"
                              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin}px, 1fr))` }}
                           >
                              {group.names.map((name) => (
                                 <button
                                    key={name}
                                    type="button"
                                    className="lora-card"
                                    data-tip={name}
                                    onClick={() => {
                                       if (target != null) setEntry(target, name, [1, 1])
                                    }}
                                 >
                                    {thumb(name, Math.round(110 * scale))}
                                    <div className="lora-label">
                                       {showTitles ? label(name) : name.slice(0, 2) + '···'}
                                       {warnBadge(name)}
                                    </div>
                                 </button>
                              ))}
                           </div>
                        </div>
                     ))}
                     {matches.length - targetNames.filter(matchesFilter).length > cardCap ? (
                        <div className="loras-more">
                           … {matches.length - targetNames.filter(matchesFilter).length - cardCap} more — refine the
                           filter, or draw
                           <input
                              type="number"
                              min={1}
                              max={2000}
                              value={cardCap}
                              data-tip="how many cards this popup draws — each one is an image request, so the right number depends on your collection and your box. Kept in this browser"
                              // an empty box is mid-edit, not a request for the default: without
                              // this, clearing the field snapped the value to 200 as you typed
                              onChange={(e) => {
                                 const n = parseInt(e.target.value, 10)
                                 if (Number.isFinite(n)) p.st.setLoraCap(n)
                              }}
                           />
                           at once
                        </div>
                     ) : null}
                     {matches.length === 0 ? <div className="loras-more">no lora matches '{local.filter}'</div> : null}
                  </div>
                  {/* the workflow's own narrowing, once, as a quiet footer line */}
                  {p.v.desc.optionsFilter == null ? null : (
                     <div className="modal-foot hint">this workflow offers loras matching {p.v.desc.optionsFilter}</div>
                  )}
               </div>
            </div>
         ) : null}
      </div>
   )
})

/** what a lora IS, from the lora-manager mirror: clicking a card opens this instead of
 * silently toggling the graph. Everything shown comes from the mirror, so an unsynced lora
 * says so rather than rendering an empty sheet */
const LoraDetails = observer(function LoraDetails(p: {
   name: string
   host: string
   hostUrl: string | null
   label: string
   showImage: boolean
   keyword: string | null
   managerOnly: boolean
   onClose(): void
}) {
   const local = useLocalObservable<{
      info: LoraInfo | 'loading' | 'error'
      about: LoraAbout | null
      aboutError: string | null
      set(v: LoraInfo | 'loading' | 'error'): void
      setAbout(v: LoraAbout | null): void
      setAboutError(msg: string): void
   }>(() => ({
      info: 'loading',
      about: null,
      aboutError: null,
      set(v) {
         this.info = v
      },
      setAbout(v) {
         this.about = v
         this.aboutError = null
      },
      setAboutError(msg: string) {
         this.about = null
         this.aboutError = msg
      },
   }))
   const { name, host } = p
   useEffect(() => {
      // the panel is ONE instance reused across loras, and /lora-about is a live host round
      // trip: without this guard, opening A then B within A's latency painted A's description
      // and example images under B's title
      let current = true
      local.set('loading')
      local.setAbout(null)
      fetchLoraInfo({ host, name })
         .then((i) => {
            if (current) local.set(i)
         })
         .catch((e: unknown) => {
            if (current) local.set('error')
            logWebError(`lora info for ${name}`, e)
         })
      // the LIVE half (civitai description + example images) arrives second: the mirror data
      // must not wait on a host round trip to render
      fetchLoraAbout({ host, name })
         .then((a) => {
            if (current) local.setAbout(a)
         })
         .catch((e: unknown) => {
            // an empty sheet reads as "this lora has nothing to say", which is a different
            // fact from "the extension did not answer"
            if (current) local.setAboutError(e instanceof Error ? e.message : String(e))
            logWebError(`lora details for ${name}`, e)
         })
      return () => {
         current = false
      }
   }, [host, name, local])
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Escape') p.onClose()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [p])
   const info = local.info
   const row = (k: string, v: ReactNode): ReactNode =>
      v == null || v === '' ? null : (
         <div className="detail-row">
            <span className="detail-key">{k}</span>
            <span className="detail-val">{v}</span>
         </div>
      )
   return (
      <div className="modal-overlay" onClick={() => p.onClose()}>
         <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
               <b style={{ flex: 1 }}>{p.label}</b>
               <button type="button" data-tip="close (esc)" onClick={() => p.onClose()}>
                  <Icon name="close" />
               </button>
            </div>
            <div className="modal-body">
               {info === 'loading' ? <div className="hint">reading the mirror…</div> : null}
               {info === 'error' ? <div className="error">🔴 could not read this lora's metadata</div> : null}
               {typeof info === 'object' ? (
                  <div className="lora-details">
                     {p.showImage ? (
                        <img className="detail-thumb" src={loraPreviewSrc({ host, name })} alt={p.label} />
                     ) : null}
                     <div className="detail-list">
                        {info.known === false ? (
                           <div className="hint">
                              newer than the copy of the lora manager's list kept here: sync reads it again
                           </div>
                        ) : null}
                        {p.managerOnly ? <div className="hint">⚠ only the lora manager lists it, not comfy</div> : null}
                        {row('file', name)}
                        {row('base model', info.baseModel)}
                        {row('folder', info.folder)}
                        {row('trigger words', info.triggerWords.join(', '))}
                        {row('prompt keyword', p.keyword)}
                        {row('tags', (info.tags ?? []).join(', '))}
                        {row('notes', info.notes)}
                        {row('size', info.fileSize == null ? null : `${(info.fileSize / 1e9).toFixed(2)} GB`)}
                        {row('path', info.filePath)}
                        {local.about?.description == null ? null : (
                           <div className="detail-desc">{local.about.description}</div>
                        )}
                        {row(
                           'civitai',
                           info.civitaiUrl == null ? null : (
                              <a href={info.civitaiUrl} target="_blank" rel="noreferrer">
                                 {info.civitaiVersion ?? 'model page'} ↗
                              </a>
                           ),
                        )}
                        {local.about != null && local.about.examples.length > 0 ? (
                           <div>
                              <div className="section-title">examples ({local.about.examples.length})</div>
                              <div className="detail-examples">
                                 {local.about.examples.slice(0, 8).map((src) => (
                                    <img key={src} src={src} alt="" loading="lazy" />
                                 ))}
                              </div>
                           </div>
                        ) : null}
                        {local.about?.examplesReason == null ? null : (
                           <div className="hint">no example images: {local.about.examplesReason}</div>
                        )}
                        {/* an empty sheet reads as "this lora has nothing to say"; that the
                            extension never answered is a different fact and must be said */}
                        {local.aboutError == null ? null : (
                           <div className="error">🔴 the lora manager did not answer: {local.aboutError}</div>
                        )}
                        {p.hostUrl == null ? null : (
                           <a className="button-link" href={`${p.hostUrl}/loras`} target="_blank" rel="noreferrer">
                              <Icon name="external" /> open in the lora manager
                           </a>
                        )}
                     </div>
                  </div>
               ) : null}
            </div>
         </div>
      </div>
   )
})
