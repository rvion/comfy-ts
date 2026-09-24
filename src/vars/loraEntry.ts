// one lora's stored setting, read the same way by LorasVar, serve and the web panel. PURE and
// dependency-free, so the browser bundle imports it without pulling ComfyVars in.
//   absent        not in the palette
//   false         off, not in the palette (what an untick in the TUI writes)
//   true | n      on, both strengths 1 | n
//   [m, c]        on, each strength
//   { strength: [m, c], off?: true, mute?: string[] }
//                 the palette form: `off` pauses it without forgetting it or its strengths,
//                 `mute` the parts of its prompt keyword (split at commas) left out of the
//                 prompt. Grouping loras into lanes is the VAR's shape, src/vars/lanes.ts

export type LoraEntry = {
   strength: [strengthModel: number, strengthClip: number]
   off?: boolean
   mute?: string[]
}

export type LoraStrength = boolean | number | [strengthModel: number, strengthClip: number] | LoraEntry

export function isLoraEntry(s: unknown): s is LoraEntry {
   if (typeof s !== 'object' || s == null || Array.isArray(s)) return false
   const o = s as Record<string, unknown>
   const st = o.strength
   return (
      Array.isArray(st) &&
      st.length === 2 &&
      typeof st[0] === 'number' &&
      Number.isFinite(st[0]) &&
      typeof st[1] === 'number' &&
      Number.isFinite(st[1]) &&
      (o.off == null || typeof o.off === 'boolean') &&
      (o.mute == null || (Array.isArray(o.mute) && o.mute.every((w) => typeof w === 'string')))
   )
}

export function isLoraStrength(s: unknown): s is LoraStrength {
   if (typeof s === 'boolean') return true
   if (typeof s === 'number') return Number.isFinite(s)
   if (Array.isArray(s)) return s.length === 2 && s.every((n) => typeof n === 'number' && Number.isFinite(n))
   return isLoraEntry(s)
}

/** on = it runs */
export function loraIsOn(s: unknown): boolean {
   if (s == null || s === false) return false
   if (isLoraEntry(s)) return s.off !== true
   return true
}

/** in the palette = on, or paused in the palette form */
export function loraInPalette(s: unknown): boolean {
   return loraIsOn(s) || (isLoraEntry(s) && s.off === true)
}

/** the strengths, whatever the spelling (1/1 when there is nothing to read) */
export function loraStrengths(s: unknown): [number, number] {
   if (typeof s === 'number' && Number.isFinite(s)) return [s, s]
   if (Array.isArray(s) && typeof s[0] === 'number' && typeof s[1] === 'number') return [s[0], s[1]]
   if (isLoraEntry(s)) return [s.strength[0], s.strength[1]]
   return [1, 1]
}

export function loraMuted(s: unknown): string[] {
   return isLoraEntry(s) && s.mute != null ? s.mute : []
}

/** a prompt keyword's parts, split at commas: each one can be left out on its own */
export function keywordParts(keyword: string): string[] {
   return [
      ...new Set(
         keyword
            .split(',')
            .map((w) => w.trim())
            .filter((w) => w !== ''),
      ),
   ]
}

/** the keyword a lora adds to the prompt once its muted parts are left out ('' = nothing) */
export function keptKeyword(keyword: string, muted: readonly string[]): string {
   return keywordParts(keyword)
      .filter((w) => !muted.includes(w))
      .join(', ')
}

/** rewrite one setting, keeping what the patch does not name. The result stays in the short
 * spellings while nothing needs the palette form, so a plain draft reads as it always did */
export function withLora(
   s: unknown,
   patch: { on?: boolean; strength?: [number, number]; mute?: readonly string[] },
): LoraStrength {
   const strength = patch.strength ?? loraStrengths(s)
   const off = patch.on == null ? !loraIsOn(s) : !patch.on
   const mute = [...(patch.mute ?? loraMuted(s))]
   if (!off && mute.length === 0) return [strength[0], strength[1]]
   return {
      strength: [strength[0], strength[1]],
      ...(off ? { off: true } : {}),
      ...(mute.length === 0 ? {} : { mute }),
   }
}
