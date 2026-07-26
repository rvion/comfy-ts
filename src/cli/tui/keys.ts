/** the key flags a modified-⏎ translation produces (subset of ink's Key) */
export type EnterKeyBits = { return: boolean; shift: boolean; meta: boolean; ctrl: boolean }

/**
 * xterm modifyOtherKeys (vscode/xterm.js — enabled by run-tui via `CSI > 4;1 m`)
 * encodes modified ⏎ as `CSI 27;<mods>;13~`. ink 7 leaves that sequence
 * unparsed: it reaches useInput as the LITERAL input `[27;<mods>;13~` with no
 * key flags, which would otherwise be typed into editors/filters. Translate it
 * back into return + modifier bits (mods is xterm's modifier-1 bitfield:
 * 1 shift · 2 alt · 4 ctrl · 8 meta — alt|meta fold into ink's `meta`, same
 * mask ink uses for legacy fn-keys). Kitty-protocol terminals never hit this:
 * their `CSI 13;2u` is parsed natively by ink. Returns null when `input` is
 * not a modified enter.
 */
export function parseModifyOtherKeysEnter(input: string): EnterKeyBits | null {
   const m = /^\[27;(\d+);13~$/.exec(input)
   if (m == null) return null
   const mods = Number(m[1]) - 1
   return { return: true, shift: (mods & 1) !== 0, meta: (mods & 10) !== 0, ctrl: (mods & 4) !== 0 }
}
