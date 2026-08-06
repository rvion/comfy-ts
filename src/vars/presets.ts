// named starting texts for a text/prompt var. PURE and dependency-free on purpose: the
// browser bundle imports it too (the web panel matches the live value against the list).
export type VarPreset = { label: string; text: string }

/** authored shape: `{ 'terse one-liner': 'reply with one sentence…' }`. Key order is display order */
export type VarPresetSpec = Record<string, string>

export function toPresetList(spec: VarPresetSpec | undefined): VarPreset[] {
   if (spec == null) return []
   return Object.entries(spec).map(([label, text]) => ({ label, text }))
}

/** which preset the value still IS, or null once it was hand-edited (trailing whitespace ignored) */
export function activePresetLabel(presets: readonly VarPreset[], value: string): string | null {
   const v = value.trim()
   return presets.find((p) => p.text.trim() === v)?.label ?? null
}
