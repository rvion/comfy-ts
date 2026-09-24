// the lines a prompt keeps VERBATIM through an enhance: negatives (`- `) and comments (`// `).
// The enhancer sends only the body to the model and writes these back itself, each on its own
// line, because a model asked to copy them glues a negative onto its last sentence often enough
// that the workflow then reads it as positive text. PURE, headless-tested

const isKept = (line: string): boolean => {
   const t = line.trimStart()
   return t.startsWith('- ') || t.startsWith('// ')
}

export function splitKeptLines(text: string): { body: string; kept: string[] } {
   const lines = text.split('\n')
   return {
      body: lines
         .filter((l) => !isKept(l))
         .join('\n')
         .trim(),
      kept: lines.filter(isKept).map((l) => l.trim()),
   }
}

/** the negative items a kept line names, lowercased: `- blurry, jpeg` → blurry, jpeg */
function negativeItems(kept: readonly string[]): Set<string> {
   const out = new Set<string>()
   for (const line of kept) {
      if (!line.startsWith('- ')) continue
      for (const item of line.slice(2).split(',')) if (item.trim() !== '') out.add(item.trim().toLowerCase())
   }
   return out
}

/** the model's rewrite with the kept lines put back: whatever negative or comment lines the
 * model wrote are dropped (the kept ones replace them), and a negative it glued onto a line
 * (`… rain. - blurry, jpeg`) is cut off when its first item is one of the kept negatives */
export function finishRewrite(model: string, kept: readonly string[]): string {
   const items = negativeItems(kept)
   const body = model
      .split('\n')
      .filter((l) => kept.length === 0 || !isKept(l))
      .map((l) => {
         if (items.size === 0) return l
         let at = l.indexOf(' - ')
         while (at !== -1) {
            const first = (l.slice(at + 3).split(',')[0] ?? '').trim().toLowerCase()
            if (items.has(first)) return l.slice(0, at).trimEnd()
            at = l.indexOf(' - ', at + 3)
         }
         return l
      })
      .join('\n')
      .trim()
   return [body, ...kept].filter((x) => x !== '').join('\n')
}
