// lanes: the second value shape of a prompt or loras var. A var holds EITHER its plain value OR
// `{ lanes: [...] }`; the build merges the active lanes in listed order. PURE and dependency-free
// (the browser bundle imports it), every shape runtime-checked like loraEntry.ts.
import { isLoraStrength, loraIsOn, type LoraStrength } from 'src/vars/loraEntry.ts'

export type PromptLane = { name: string; prompt: string; active: boolean }
export type PromptLanes = { lanes: PromptLane[] }
export type PromptInput = string | PromptLanes

export type LoraRecord<T extends string = string> = Partial<Record<T, LoraStrength>>
export type LoraLane<T extends string = string> = { name: string; active: boolean; loras: LoraRecord<T> }
export type LoraLanes<T extends string = string> = { lanes: LoraLane<T>[] }
/** a lora file is never named `lanes` (options end in .safetensors), so the plain record and the
 * lanes object can never be mistaken for each other */
export type LorasInput<T extends string = string> = LoraRecord<T> | LoraLanes<T>

export const FIRST_LANE = 'main'

function isObject(v: unknown): v is Record<string, unknown> {
   return typeof v === 'object' && v != null && !Array.isArray(v)
}

// ---- prompt ----

export function isPromptLane(v: unknown): v is PromptLane {
   return isObject(v) && typeof v.name === 'string' && typeof v.prompt === 'string' && typeof v.active === 'boolean'
}

export function isPromptLanes(v: unknown): v is PromptLanes {
   return isObject(v) && Array.isArray(v.lanes) && v.lanes.every(isPromptLane)
}

export function isPromptInput(v: unknown): v is PromptInput {
   return typeof v === 'string' || isPromptLanes(v)
}

/** the text the build reads: the active lanes joined in order, one line break between them, so
 * `//` and `- ` lines keep working inside every lane */
export function promptText(v: PromptInput): string {
   if (typeof v === 'string') return v
   return v.lanes
      .filter((l) => l.active)
      .map((l) => l.prompt)
      .join('\n')
}

export function toPromptLanes(v: PromptInput): PromptLanes {
   return typeof v === 'string' ? { lanes: [{ name: FIRST_LANE, prompt: v, active: true }] } : v
}

/** back to one string: only when it loses nothing (a single active lane) */
export function promptFromLanes(v: PromptLanes): string | null {
   const only = v.lanes[0]
   return v.lanes.length === 1 && only != null && only.active ? only.prompt : null
}

// the TUI edits a prompt as text: lanes round-trip through header lines, so it never flattens
// them. `# name` starts a lane, `# name (off)` an inactive one
const HEADER = /^# (.+?)( \(off\))?$/

export function promptLanesToText(v: PromptLanes): string {
   return v.lanes.map((l) => `# ${l.name}${l.active ? '' : ' (off)'}\n${l.prompt}`).join('\n')
}

/** text before the first header lands in a lane named FIRST_LANE, so no typed line is lost */
export function promptLanesFromText(text: string): PromptLanes {
   const lanes: PromptLane[] = []
   let current: PromptLane | null = null
   const body: string[] = []
   const close = (): void => {
      if (current != null) lanes.push({ ...current, prompt: body.join('\n') })
      else if (body.some((l) => l.trim() !== ''))
         lanes.push({ name: FIRST_LANE, prompt: body.join('\n'), active: true })
      body.length = 0
   }
   for (const line of text.split('\n')) {
      const m = HEADER.exec(line)
      if (m == null) {
         body.push(line)
         continue
      }
      close()
      current = { name: (m[1] ?? '').trim(), prompt: '', active: m[2] == null }
   }
   close()
   return { lanes: lanes.length > 0 ? lanes : [{ name: FIRST_LANE, prompt: '', active: true }] }
}

// ---- loras ----

function isLoraRecord(v: unknown): v is LoraRecord {
   return isObject(v) && !('lanes' in v) && Object.values(v).every((s) => s == null || isLoraStrength(s))
}

export function isLoraLane(v: unknown): v is LoraLane {
   return isObject(v) && typeof v.name === 'string' && typeof v.active === 'boolean' && isLoraRecord(v.loras)
}

export function isLoraLanes<T extends string>(v: LorasInput<T>): v is LoraLanes<T>
export function isLoraLanes(v: unknown): v is LoraLanes
export function isLoraLanes(v: unknown): v is LoraLanes {
   return isObject(v) && Array.isArray(v.lanes) && v.lanes.every(isLoraLane)
}

export function isLorasInput(v: unknown): v is LorasInput {
   return isLoraRecord(v) || isLoraLanes(v)
}

/** one record for the build: the active lanes in order. A lora in two active lanes keeps its
 * FIRST setting, and `duplicates` names it so the caller can say so */
export function flattenLoras<T extends string>(v: LorasInput<T>): { record: LoraRecord<T>; duplicates: T[] } {
   if (!isLoraLanes(v)) return { record: v, duplicates: [] }
   const record: LoraRecord<T> = {}
   const duplicates: T[] = []
   for (const lane of v.lanes) {
      if (!lane.active) continue
      for (const [name, st] of Object.entries(lane.loras) as [T, LoraStrength | undefined][]) {
         if (st == null) continue
         if (name in record) duplicates.push(name)
         else record[name] = st
      }
   }
   return { record, duplicates }
}

export function toLoraLanes<T extends string>(v: LorasInput<T>): LoraLanes<T> {
   return isLoraLanes(v) ? v : { lanes: [{ name: FIRST_LANE, active: true, loras: v }] }
}

export function lorasFromLanes<T extends string>(v: LoraLanes<T>): LoraRecord<T> | null {
   const only = v.lanes[0]
   return v.lanes.length === 1 && only != null && only.active ? only.loras : null
}

/** where a lora lives, so an edit lands in the lane that holds it: the first ACTIVE lane that
 * has it (the one the build reads), else any lane, else -1 */
export function laneIndexOf<T extends string>(v: LoraLanes<T>, name: T): number {
   const active = v.lanes.findIndex((l) => l.active && l.loras[name] != null)
   return active !== -1 ? active : v.lanes.findIndex((l) => l.loras[name] != null)
}

/** rewrite one lora's setting wherever it lives (plain record, or its lane). `null` removes it.
 * A lora in no lane yet lands in the first lane */
export function updateLora<T extends string>(v: LorasInput<T>, name: T, next: LoraStrength | null): LorasInput<T> {
   const write = (rec: LoraRecord<T>): LoraRecord<T> => {
      const out = { ...rec }
      if (next == null) delete out[name]
      else out[name] = next
      return out
   }
   if (!isLoraLanes(v)) return write(v)
   if (v.lanes.length === 0) return { lanes: [{ name: FIRST_LANE, active: true, loras: write({}) }] }
   const found = laneIndexOf(v, name)
   const ix = found === -1 ? 0 : found
   return { lanes: v.lanes.map((l, i) => (i === ix ? { ...l, loras: write(l.loras) } : l)) }
}

// ---- lane list edits, the same for prompt and lora lanes ----

type NamedLane = { name: string; active: boolean }

/** a name no other lane has: `lane 2`, `lane 3`… */
export function newLaneName(lanes: readonly NamedLane[]): string {
   const taken = new Set(lanes.map((l) => l.name))
   let n = lanes.length + 1
   while (taken.has(`lane ${n}`)) n++
   return `lane ${n}`
}

export function patchLane<L extends NamedLane>(lanes: readonly L[], ix: number, patch: Partial<L>): L[] {
   return lanes.map((l, i) => (i === ix ? { ...l, ...patch } : l))
}

/** move a lane up (-1) or down (+1); out of range changes nothing */
export function moveLane<L>(lanes: readonly L[], ix: number, delta: number): L[] {
   const to = ix + delta
   if (ix < 0 || ix >= lanes.length || to < 0 || to >= lanes.length) return [...lanes]
   const out = [...lanes]
   const [moved] = out.splice(ix, 1)
   if (moved != null) out.splice(to, 0, moved)
   return out
}

export function removeLane<L>(lanes: readonly L[], ix: number): L[] {
   return lanes.filter((_, i) => i !== ix)
}

/** move one lora to another lane (or another slot of its own), before `beforeName` or last */
export function moveLoraToLane<T extends string>(
   v: LoraLanes<T>,
   p: { from: number; name: T; to: number; beforeName?: T },
): LoraLanes<T> {
   const src = v.lanes[p.from]
   const setting = src?.loras[p.name]
   if (src == null || setting == null || v.lanes[p.to] == null) return v
   const lanes = v.lanes.map((l) => ({ ...l, loras: { ...l.loras } }))
   const from = lanes[p.from]
   const to = lanes[p.to]
   if (from == null || to == null) return v
   delete from.loras[p.name]
   const out: LoraRecord<T> = {}
   let placed = false
   for (const [k, st] of Object.entries(to.loras) as [T, LoraStrength | undefined][]) {
      if (k === p.beforeName && !placed) {
         out[p.name] = setting
         placed = true
      }
      out[k] = st
   }
   if (!placed) out[p.name] = setting
   to.loras = out
   return { lanes }
}

/** one lora's stored setting wherever it lives, inactive lanes included (the lane an edit
 * would write to, `updateLora`), or undefined */
export function loraSetting<T extends string>(v: LorasInput<T>, name: T): LoraStrength | undefined {
   if (!isLoraLanes(v)) return v[name]
   return v.lanes[laneIndexOf(v, name)]?.loras[name]
}

/** every lora in the palette of either shape, each once, with whether the build runs it: a lora
 * in an inactive lane, or paused, is there but not running */
export function paletteLoras<T extends string>(
   v: LorasInput<T>,
): { name: T; setting: LoraStrength; running: boolean }[] {
   const out = new Map<T, { name: T; setting: LoraStrength; running: boolean }>()
   const lanes = isLoraLanes(v) ? v.lanes : [{ name: '', active: true, loras: v }]
   for (const lane of lanes)
      for (const [name, setting] of Object.entries(lane.loras) as [T, LoraStrength | undefined][]) {
         if (setting == null || setting === false) continue
         const running = lane.active && loraIsOn(setting)
         const seen = out.get(name)
         // a running copy wins over a stopped one, as it does in the build
         if (seen == null || (!seen.running && running)) out.set(name, { name, setting, running })
      }
   return [...out.values()]
}
