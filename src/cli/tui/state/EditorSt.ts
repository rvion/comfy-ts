import { makeAutoObservable } from 'mobx'
import type { TuiMode, TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/**
 * line/multiline editor. Inline mode ('edit') escapes newlines into a single
 * line (numbers only, in practice); multiline mode ('overlay-text') keeps REAL
 * newlines. All ops are code-point based so emoji/astral input never splits a
 * surrogate pair (flag/ZWJ clusters may still count as several points).
 */
export class EditorSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<EditorSt, 'st'>(this, { st: false })
   }

   buffer: string = ''
   /** caret position, counted in CODE POINTS (0..pointLen) */
   cursor: number = 0
   invalid: boolean = false

   /** raw value -> escaped single-line buffer form (order matters: backslashes first) */
   static escapeForBuffer(raw: string): string {
      return raw.replaceAll('\\', '\\\\').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', '\\n')
   }

   /** escaped buffer form -> raw value */
   static unescapeBuffer(buffer: string): string {
      return buffer.replace(/\\\\|\\n/g, (m) => (m === '\\\\' ? '\\' : '\n'))
   }

   /** non-var session (draft naming etc.): commit goes to the callback, not the selected var */
   customCommit: ((raw: string) => boolean) | null = null
   customTitle: string = ''
   private returnMode: TuiMode = 'nav'

   get isCustom(): boolean {
      return this.customCommit != null
   }

   /** inline single-line editor (numbers, seed `mode value`) */
   beginInline(): void {
      const sel = this.st.selected?.[1]
      if (sel == null) return
      this.st.mode = 'edit'
      this.buffer = EditorSt.escapeForBuffer(sel.toEditBuffer())
      this.cursor = [...this.buffer].length
      this.invalid = false
   }

   /** modal prompt over an arbitrary string (rendered as PromptOverlay);
    * onCommit returns false to keep editing (invalid); esc/apply lands on returnMode */
   beginCustom(p: { title: string; initial: string; onCommit: (raw: string) => boolean; returnMode?: TuiMode }): void {
      this.st.mode = 'edit'
      this.customCommit = p.onCommit
      this.customTitle = p.title
      this.returnMode = p.returnMode ?? 'nav'
      this.buffer = EditorSt.escapeForBuffer(p.initial)
      this.cursor = [...this.buffer].length
      this.invalid = false
   }

   /** modal multiline editor (text vars), no escaping */
   beginMultiline(): void {
      const sel = this.st.selected?.[1]
      if (sel == null) return
      this.st.mode = 'overlay-text'
      this.buffer = String(sel.value)
      this.cursor = [...this.buffer].length
      this.invalid = false
   }

   commitInline(): void {
      if (this.customCommit != null) {
         if (this.customCommit(EditorSt.unescapeBuffer(this.buffer))) {
            this.customCommit = null
            this.st.mode = this.returnMode
         } else this.invalid = true
         return
      }
      const sel = this.st.selected?.[1]
      if (sel == null) return
      if (sel.parse(EditorSt.unescapeBuffer(this.buffer))) this.st.mode = 'nav'
      else this.invalid = true
   }

   commitMultiline(): void {
      const sel = this.st.selected?.[1]
      if (sel == null) return
      if (sel.parse(this.buffer)) this.st.mode = 'nav'
      else this.invalid = true
   }

   cancel(): void {
      this.st.mode = this.customCommit != null ? this.returnMode : 'nav'
      this.invalid = false
      this.customCommit = null
   }

   // ---- readline-style ops (code-point based) ----
   private get chars(): string[] {
      return [...this.buffer]
   }

   private setChars(cs: string[], cursor: number): void {
      this.buffer = cs.join('')
      this.cursor = Math.max(0, Math.min(cursor, cs.length))
      this.invalid = false
   }

   input(chunk: string): void {
      // multiline keeps real newlines; inline escapes to a single line
      const normalized =
         this.st.mode === 'overlay-text'
            ? chunk.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
            : EditorSt.escapeForBuffer(chunk)
      const insert = [...normalized]
      const cs = this.chars
      cs.splice(this.cursor, 0, ...insert)
      this.setChars(cs, this.cursor + insert.length)
   }

   backspace(): void {
      if (this.cursor === 0) return
      const cs = this.chars
      cs.splice(this.cursor - 1, 1)
      this.setChars(cs, this.cursor - 1)
   }

   newline(): void {
      const cs = this.chars
      cs.splice(this.cursor, 0, '\n')
      this.setChars(cs, this.cursor + 1)
   }

   /** index of the start of the word left of the cursor */
   private wordBoundLeft(): number {
      const cs = this.chars
      let i = this.cursor
      while (i > 0 && /\s/.test(cs[i - 1] ?? '')) i--
      while (i > 0 && !/\s/.test(cs[i - 1] ?? '')) i--
      return i
   }

   /** index just past the word right of the cursor */
   private wordBoundRight(): number {
      const cs = this.chars
      let i = this.cursor
      while (i < cs.length && /\s/.test(cs[i] ?? '')) i++
      while (i < cs.length && !/\s/.test(cs[i] ?? '')) i++
      return i
   }

   /** alt+backspace / ctrl+w */
   deleteWordBack(): void {
      const from = this.wordBoundLeft()
      const cs = this.chars
      cs.splice(from, this.cursor - from)
      this.setChars(cs, from)
   }

   /** ctrl+u: clear from start to cursor */
   killToStart(): void {
      this.setChars(this.chars.slice(this.cursor), 0)
   }

   /** ctrl+k: clear from cursor to end */
   killToEnd(): void {
      this.setChars(this.chars.slice(0, this.cursor), this.cursor)
   }

   cursorLeft(): void {
      if (this.cursor > 0) this.cursor--
   }

   cursorRight(): void {
      if (this.cursor < this.chars.length) this.cursor++
   }

   /** alt+left / esc-b */
   wordLeft(): void {
      this.cursor = this.wordBoundLeft()
   }

   /** alt+right / esc-f */
   wordRight(): void {
      this.cursor = this.wordBoundRight()
   }

   /** start index (in code points) of the line containing ix */
   private lineStartAt(ix: number): number {
      const cs = this.chars
      let i = ix
      while (i > 0 && cs[i - 1] !== '\n') i--
      return i
   }

   /** end index (exclusive, before the \n) of the line containing ix */
   private lineEndAt(ix: number): number {
      const cs = this.chars
      let i = ix
      while (i < cs.length && cs[i] !== '\n') i++
      return i
   }

   /** Home / ⌘← / ⌃A: start of the LOGICAL line; already there → the previous line's start */
   lineHome(): void {
      const start = this.lineStartAt(this.cursor)
      if (this.cursor !== start || start === 0) return void (this.cursor = start)
      this.cursor = this.lineStartAt(start - 1)
   }

   /** End / ⌘→ / ⌃E: end of the LOGICAL line; already there → the next line's end */
   lineEnd(): void {
      const end = this.lineEndAt(this.cursor)
      if (this.cursor !== end || end === this.chars.length) return void (this.cursor = end)
      this.cursor = this.lineEndAt(end + 1)
   }

   /** ⌥↑/⌥↓: swap the cursor's logical line with its neighbor, cursor rides along */
   moveLine(delta: -1 | 1): void {
      const cs = this.chars
      const start = this.lineStartAt(this.cursor)
      const end = this.lineEndAt(this.cursor)
      const col = this.cursor - start
      const cur = cs.slice(start, end)
      if (delta === -1) {
         if (start === 0) return
         const prevStart = this.lineStartAt(start - 1)
         const prev = cs.slice(prevStart, start - 1)
         this.setChars(
            [...cs.slice(0, prevStart), ...cur, '\n', ...prev, ...cs.slice(end)],
            prevStart + Math.min(col, cur.length),
         )
      } else {
         if (end === cs.length) return
         const nextEnd = this.lineEndAt(end + 1)
         const next = cs.slice(end + 1, nextEnd)
         this.setChars(
            [...cs.slice(0, start), ...next, '\n', ...cur, ...cs.slice(nextEnd)],
            start + next.length + 1 + Math.min(col, cur.length),
         )
      }
   }

   /** ⌘/ / ⌃/ / ⌥/: toggle `// ` at the start of the cursor's line */
   toggleComment(): void {
      const cs = this.chars
      const start = this.lineStartAt(this.cursor)
      const end = this.lineEndAt(this.cursor)
      const line = cs.slice(start, end).join('')
      const m = /^(\s*)\/\/ ?/.exec(line)
      if (m == null) {
         cs.splice(start, 0, '/', '/', ' ')
         this.setChars(cs, this.cursor + 3)
         return
      }
      const indentLen = [...(m[1] ?? '')].length
      const removeLen = [...m[0]].length - indentLen
      cs.splice(start + indentLen, removeLen)
      this.setChars(cs, Math.max(start, this.cursor - removeLen))
   }

   cursorUp(): void {
      const start = this.lineStartAt(this.cursor)
      if (start === 0) {
         this.cursor = 0
         return
      }
      const col = this.cursor - start
      const prevStart = this.lineStartAt(start - 1)
      const prevLen = start - 1 - prevStart
      this.cursor = prevStart + Math.min(col, prevLen)
   }

   cursorDown(): void {
      const cs = this.chars
      const start = this.lineStartAt(this.cursor)
      const col = this.cursor - start
      let end = this.cursor
      while (end < cs.length && cs[end] !== '\n') end++
      if (end === cs.length) {
         this.cursor = cs.length
         return
      }
      const nextStart = end + 1
      let nextEnd = nextStart
      while (nextEnd < cs.length && cs[nextEnd] !== '\n') nextEnd++
      this.cursor = nextStart + Math.min(col, nextEnd - nextStart)
   }
}
