// the preview pane never shifts: every part it can show is always there, at one size. These are
// the pure halves: what a run chip says and what a collapsed prompt preview shows

/** a chip's text at a FIXED shape: the count is the only part that changes, and the css gives it
 * a width and tabular digits, so 9 → 10 → 100 never pushes a neighbour */
export function runChipText(p: { kind: 'queue' | 'results'; count: number }): { label: string; count: string } {
   return { label: p.kind, count: String(Math.max(0, Math.min(999, Math.round(p.count)))) }
}

/** a collapsed preview is ALWAYS two lines, whatever the prompt holds: the positive lines joined,
 * then the negative ones joined (empty when there are none). Typing a line break or a `- ` line
 * changes what the two lines say, never how many there are */
export function collapsedPreview(text: string): { positive: string; negative: string } {
   const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
   const negative = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim())
   const positive = lines.filter((l) => !l.startsWith('- '))
   return { positive: positive.join(' · '), negative: negative.join(' · ') }
}
