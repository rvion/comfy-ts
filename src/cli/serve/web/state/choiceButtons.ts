// a choice var with a few short options renders as a row of buttons, every option visible and
// one click away; anything longer stays a select. PURE, tests/serve-web-choice-buttons.test.ts
export const MAX_BUTTONS = 5
export const MAX_BUTTON_LABEL = 16

export function choiceAsButtons(choices: readonly string[]): boolean {
   return choices.length > 0 && choices.length <= MAX_BUTTONS && choices.every((c) => c.length <= MAX_BUTTON_LABEL)
}

export type ChoiceSelectMode = 'one' | 'zero-or-one' | 'many'

/** the options picked right now, whatever the shape: one value, one or null, or a list */
export function pickedChoices(value: unknown): string[] {
   if (typeof value === 'string') return [value]
   if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string')
   return []
}

/** the value after clicking option `c`: `one` picks it, `zero-or-one` picks it or clears it,
 * `many` toggles it, the list kept in the order of the choices */
export function clickChoice(p: {
   select: ChoiceSelectMode
   choices: readonly string[]
   value: unknown
   c: string
}): string | string[] | null {
   if (p.select === 'one') return p.c
   const picked = pickedChoices(p.value)
   if (p.select === 'zero-or-one') return picked.includes(p.c) ? null : p.c
   const on = picked.includes(p.c)
   return p.choices.filter((x) => (x === p.c ? !on : picked.includes(x)))
}

/** a value from OUTSIDE (the embedding page) held to what this choice can hold */
export function acceptChoice(p: {
   select: ChoiceSelectMode
   choices: readonly string[]
   raw: unknown
}): { ok: true; value: string | string[] | null } | { ok: false } {
   const known = (x: unknown): x is string => typeof x === 'string' && p.choices.includes(x)
   if (p.select === 'many')
      return Array.isArray(p.raw) && p.raw.every(known)
         ? { ok: true, value: p.choices.filter((c) => Array.isArray(p.raw) && p.raw.includes(c)) }
         : { ok: false }
   if (p.select === 'zero-or-one') return p.raw === null || known(p.raw) ? { ok: true, value: p.raw } : { ok: false }
   return known(p.raw) ? { ok: true, value: p.raw } : { ok: false }
}
