// prompt text rules shared by the build (PromptVar.outValue) and the web editor, so the editor's
// colors can never disagree with what a run sends. PURE and import-free: the browser bundle takes it

/** a whole line that is a comment (the TUI colors these) */
export const COMMENT_LINE_RE = /^\s*\/\//
/** a negative prompt line: `- ` then its text */
export const NEGATIVE_LINE_RE = /^\s*- (.*)$/
const NEGATIVE_PREFIX_RE = /^(\s*)- /

/** where a `//` comment starts on this line, -1 when none. Only at line start or after
 * whitespace, so `http://host` is never cut */
export function commentStart(line: string): number {
   const m = /(?:^|\s)\/\//.exec(line)
   if (m == null) return -1
   return m.index + m[0].length - 2
}

/** the line without its comment, trailing whitespace dropped with it */
function withoutComment(line: string): { text: string; hadComment: boolean } {
   const c = commentStart(line)
   return c < 0 ? { text: line, hadComment: false } : { text: line.slice(0, c).trimEnd(), hadComment: true }
}

/** the build's reading of a prompt: comments out, `- ` lines comma-joined into the negative */
export function parsePromptText(text: string): { positive: string; negative: string } {
   const pos: string[] = []
   const neg: string[] = []
   for (const raw of text.split('\n')) {
      const cut = withoutComment(raw)
      if (cut.hadComment && cut.text.trim() === '') continue
      const m = NEGATIVE_PREFIX_RE.exec(raw)
      if (m != null && m[0].length <= cut.text.length + 1) {
         const body = cut.text.slice(m[0].length).trim()
         if (body !== '') neg.push(body)
      } else pos.push(cut.text)
   }
   return { positive: pos.join('\n').trim(), negative: neg.join(', ') }
}

// #region lines ---------------------------------------------------------------

type Line = { from: number; text: string }

function linesOf(text: string): Line[] {
   const out: Line[] = []
   let from = 0
   for (const t of text.split('\n')) {
      out.push({ from, text: t })
      from += t.length + 1
   }
   return out
}

// #region weights --------------------------------------------------------------

/** one `(text:1.2)` group on a line, offsets local to that line */
export type WeightGroup = {
   from: number
   to: number
   innerFrom: number
   innerTo: number
   numFrom: number
   numTo: number
   weight: number
}

/** ComfyUI weight groups, innermost only (no nested parens inside), `\(` `\)` skipped as literal */
export function findWeights(line: string): WeightGroup[] {
   const out: WeightGroup[] = []
   const re = /(?<!\\)\(((?:\\[()]|[^()])*?):\s*(-?\d*\.?\d+)\s*(?<!\\)\)/g
   for (let m = re.exec(line); m != null; m = re.exec(line)) {
      const inner = m[1] ?? ''
      const num = m[2] ?? '1'
      const from = m.index
      const to = from + m[0].length
      const numFrom = from + m[0].lastIndexOf(num)
      out.push({
         from,
         to,
         innerFrom: from + 1,
         innerTo: from + 1 + inner.length,
         numFrom,
         numTo: numFrom + num.length,
         weight: Number(num),
      })
   }
   return out
}

const round2 = (n: number): number => Math.round(n * 100) / 100
export const formatWeight = (w: number): string => String(round2(w))

export type TextChange = { from: number; to: number; insert: string }
export type EditResult = { changes: TextChange[]; selection: { anchor: number; head: number } }

/** the comma-separated chunk around `col`, trimmed, never reaching into a comment */
function tagAround(line: string, col: number): { from: number; to: number } | null {
   const c = commentStart(line)
   const end = c < 0 ? line.length : c
   if (col > end) return null
   let from = col
   while (from > 0 && line[from - 1] !== ',') from--
   let to = col
   while (to < end && line[to] !== ',') to++
   const neg = NEGATIVE_PREFIX_RE.exec(line)
   if (neg != null && from < neg[0].length) from = neg[0].length
   while (from < to && /\s/.test(line[from] ?? '')) from++
   while (to > from && /\s/.test(line[to - 1] ?? '')) to--
   return from < to ? { from, to } : null
}

/** weight ± delta on the selection, or on the tag under the cursor when nothing is selected.
 * Inside a group its number moves, and reaching 1 unwraps it; plain text gets wrapped. null when
 * there is nothing to weigh (an empty chunk, a comment, a selection over several lines) */
export function adjustWeight(text: string, from: number, to: number, delta: number): EditResult | null {
   const line = linesOf(text).find((l) => from >= l.from && from <= l.from + l.text.length)
   if (line == null || to > line.from + line.text.length) return null
   const f = from - line.from
   const t = to - line.from
   const c = commentStart(line.text)
   if (c >= 0 && f >= c) return null
   const enclosing = findWeights(line.text)
      .filter((g) => f >= g.from && t <= g.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0]
   if (enclosing != null) {
      const w = round2(enclosing.weight + delta)
      const inner = line.text.slice(enclosing.innerFrom, enclosing.innerTo)
      if (w === 1) {
         const at = line.from + enclosing.from
         return {
            changes: [{ from: at, to: line.from + enclosing.to, insert: inner }],
            selection: { anchor: at, head: at + inner.length },
         }
      }
      return {
         changes: [{ from: line.from + enclosing.numFrom, to: line.from + enclosing.numTo, insert: formatWeight(w) }],
         selection: { anchor: line.from + enclosing.innerFrom, head: line.from + enclosing.innerTo },
      }
   }
   let span: { from: number; to: number } | null
   if (f === t) span = tagAround(line.text, f)
   else {
      let a = f
      let b = t
      while (a < b && /\s/.test(line.text[a] ?? '')) a++
      while (b > a && /\s/.test(line.text[b - 1] ?? '')) b--
      span = a < b ? { from: a, to: b } : null
   }
   if (span == null) return null
   const w = round2(1 + delta)
   const at = line.from + span.from
   const end = line.from + span.to
   return {
      changes: [
         { from: at, to: at, insert: '(' },
         { from: end, to: end, insert: `:${formatWeight(w)})` },
      ],
      selection: { anchor: at + 1, head: end + 1 },
   }
}

// #region line toggles -------------------------------------------------------

/** the lines a selection touches; a selection ending at column 0 leaves that last line out */
function touchedLines(text: string, from: number, to: number): Line[] {
   const all = linesOf(text)
   const endAt = to > from && all.some((l) => l.from === to) ? to - 1 : to
   return all.filter((l) => l.from + l.text.length >= from && l.from <= endAt)
}

/** ⌘/ — comment the touched lines, or uncomment them when every non-empty one already is */
export function toggleComment(text: string, from: number, to: number): TextChange[] {
   const lines = touchedLines(text, from, to).filter((l) => l.text.trim() !== '')
   if (lines.length === 0) return []
   if (lines.every((l) => COMMENT_LINE_RE.test(l.text)))
      return lines.map((l) => {
         const at = l.text.indexOf('//')
         const len = l.text[at + 2] === ' ' ? 3 : 2
         return { from: l.from + at, to: l.from + at + len, insert: '' }
      })
   return lines
      .filter((l) => !COMMENT_LINE_RE.test(l.text))
      .map((l) => {
         const at = l.from + (/^\s*/.exec(l.text)?.[0].length ?? 0)
         return { from: at, to: at, insert: '// ' }
      })
}

/** ⌘⇧- — move the touched lines into the negative prompt, or back out when all already are.
 * Comment lines are left alone */
export function toggleNegative(text: string, from: number, to: number): TextChange[] {
   const lines = touchedLines(text, from, to).filter((l) => l.text.trim() !== '' && !COMMENT_LINE_RE.test(l.text))
   if (lines.length === 0) return []
   if (lines.every((l) => NEGATIVE_PREFIX_RE.test(l.text)))
      return lines.map((l) => {
         const indent = NEGATIVE_PREFIX_RE.exec(l.text)?.[1]?.length ?? 0
         return { from: l.from + indent, to: l.from + indent + 2, insert: '' }
      })
   return lines
      .filter((l) => !NEGATIVE_PREFIX_RE.test(l.text))
      .map((l) => {
         const at = l.from + (/^\s*/.exec(l.text)?.[0].length ?? 0)
         return { from: at, to: at, insert: '- ' }
      })
}

// #region highlighting -------------------------------------------------------

export type PromptMarkKind = 'comment' | 'negative' | 'negative-dash' | 'weight-paren' | 'weight-num'
export type PromptMark = { from: number; to: number; kind: PromptMarkKind }

/** what the editor colors, in document order */
export function promptMarks(text: string): PromptMark[] {
   const out: PromptMark[] = []
   for (const l of linesOf(text)) {
      const c = commentStart(l.text)
      const end = c < 0 ? l.text.length : c
      const neg = NEGATIVE_PREFIX_RE.exec(l.text)
      if (neg != null && neg[0].length <= end + 1) {
         const dash = l.from + neg[0].length - 2
         out.push({ from: dash, to: dash + 1, kind: 'negative-dash' })
         if (l.from + neg[0].length < l.from + end)
            out.push({ from: l.from + neg[0].length, to: l.from + end, kind: 'negative' })
      }
      for (const g of findWeights(l.text.slice(0, end))) {
         out.push({ from: l.from + g.from, to: l.from + g.innerFrom, kind: 'weight-paren' })
         out.push({ from: l.from + g.innerTo, to: l.from + g.numFrom, kind: 'weight-paren' })
         out.push({ from: l.from + g.numFrom, to: l.from + g.numTo, kind: 'weight-num' })
         out.push({ from: l.from + g.numTo, to: l.from + g.to, kind: 'weight-paren' })
      }
      if (c >= 0) out.push({ from: l.from + c, to: l.from + l.text.length, kind: 'comment' })
   }
   return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

// #region tag issues ---------------------------------------------------------

/** the form two tags are compared in: weight wrapper off, literal parens unescaped, lowercase,
 * underscores as spaces */
export function normalizeTag(chunk: string): string {
   let s = chunk.trim()
   const whole = findWeights(s)[0]
   if (whole != null && whole.from === 0 && whole.to === s.length) s = s.slice(whole.innerFrom, whole.innerTo)
   return s
      .replace(/\\([()])/g, '$1')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
}

export type TagIssue = { from: number; to: number; message: string }

type Chunk = { from: number; to: number; tag: string }

function chunksOf(line: string, offset: number, start: number): Chunk[] {
   const out: Chunk[] = []
   let from = start
   for (let i = start; i <= line.length; i++) {
      if (i < line.length && line[i] !== ',') continue
      const raw = line.slice(from, i)
      const lead = raw.length - raw.trimStart().length
      const tag = normalizeTag(raw)
      if (tag !== '') out.push({ from: offset + from + lead, to: offset + from + raw.trimEnd().length, tag })
      from = i + 1
   }
   return out
}

/** a tag written twice, a tag a lora already adds, a tag in both prompts, and every weight when
 * the model ignores weights. Each issue carries the sentence the editor shows on hover */
export function tagIssues(
   text: string,
   p: { injected?: readonly { tag: string; source: string }[]; weights?: boolean } = {},
): TagIssue[] {
   const out: TagIssue[] = []
   const positive: Chunk[] = []
   const negative: Chunk[] = []
   for (const l of linesOf(text)) {
      if (COMMENT_LINE_RE.test(l.text)) continue
      const body = withoutComment(l.text).text
      const neg = NEGATIVE_PREFIX_RE.exec(l.text)
      const isNeg = neg != null && neg[0].length <= body.length + 1
      const chunks = chunksOf(body, l.from, isNeg ? neg[0].length : 0)
      ;(isNeg ? negative : positive).push(...chunks)
      if (p.weights === false)
         for (const g of findWeights(body))
            out.push({
               from: l.from + g.from,
               to: l.from + g.to,
               message: 'this model ignores weights: the text inside is read, the number is not',
            })
   }
   const injected = new Map<string, string>()
   for (const i of p.injected ?? []) {
      const tag = normalizeTag(i.tag)
      if (tag !== '' && !injected.has(tag)) injected.set(tag, i.source)
   }
   const scan = (side: Chunk[], sideName: string): void => {
      const seen = new Set<string>()
      for (const ch of side) {
         if (seen.has(ch.tag)) out.push({ from: ch.from, to: ch.to, message: `'${ch.tag}' is already in the ${sideName}` })
         seen.add(ch.tag)
      }
   }
   scan(positive, 'prompt')
   scan(negative, 'negative prompt')
   const negTags = new Set(negative.map((c) => c.tag))
   for (const ch of positive) {
      const source = injected.get(ch.tag)
      if (source != null) out.push({ from: ch.from, to: ch.to, message: `'${ch.tag}' is already added by the lora ${source}` })
      if (negTags.has(ch.tag)) out.push({ from: ch.from, to: ch.to, message: `'${ch.tag}' is also in the negative prompt` })
   }
   return out.sort((a, b) => a.from - b.from)
}

// #region token estimate ------------------------------------------------------

/** a rough CLIP token count of what the build sends as positive: one per short word, long words
 * split, one per punctuation mark. An ESTIMATE, the editor shows it with ≈ */
export function estimateTokens(text: string): number {
   const body = parsePromptText(text).positive
   let n = 0
   for (const m of body.matchAll(/\p{L}+|\p{N}|[^\s\p{L}\p{N}]/gu)) {
      const w = m[0]
      n += /^\p{L}/u.test(w) && w.length > 8 ? Math.ceil(w.length / 5) : 1
   }
   return n
}

// #region completion ------------------------------------------------------------

/** the partial tag being typed at `col`: from the last `,` `(` or line start, leading spaces
 * and a negative `- ` skipped. null inside a comment */
export function completionWord(line: string, col: number): { from: number; text: string } | null {
   const c = commentStart(line)
   if (c >= 0 && col > c) return null
   let from = col
   while (from > 0 && !/[,(]/.test(line[from - 1] ?? '')) from--
   const neg = NEGATIVE_PREFIX_RE.exec(line)
   if (neg != null && from < neg[0].length) from = neg[0].length
   while (from < col && /\s/.test(line[from] ?? '')) from++
   return { from, text: line.slice(from, col) }
}

export type TagFormat = { underscores?: boolean; weights?: boolean; artistPrefix?: string }

/** a tag list name as the prompt wants it. Underscores between letters become spaces (`>_<`
 * keeps its own), parens get escaped where ComfyUI would read them as emphasis */
export function formatTag(name: string, category: number | null, p: TagFormat): string {
   let s = p.underscores === true ? name : name.replace(/(?<=[\p{L}\p{N})])_(?=[\p{L}\p{N}(])/gu, ' ')
   if (p.weights !== false) s = s.replace(/(?<!\\)([()])/g, '\\$1')
   if (category === TAG_CATEGORY_ARTIST && p.artistPrefix != null) s = `${p.artistPrefix}${s}`
   return s
}

/** danbooru categories as the a1111 tagcomplete csv numbers them */
export const TAG_CATEGORY_ARTIST = 1
export const TAG_CATEGORY_NAMES: Record<number, string> = {
   0: 'general',
   1: 'artist',
   3: 'copyright',
   4: 'character',
   5: 'meta',
}
