// the CodeMirror side of the prompt editor: colors, keys and completion, every rule taken from
// src/vars/promptSyntax.ts so the editor shows exactly what a run will send
import {
   autocompletion,
   type Completion,
   type CompletionContext,
   type CompletionResult,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, moveLineDown, moveLineUp } from '@codemirror/commands'
import { EditorSelection, Prec, StateEffect, type Extension } from '@codemirror/state'
import {
   Decoration,
   EditorView,
   keymap,
   placeholder,
   ViewPlugin,
   type Command,
   type DecorationSet,
   type ViewUpdate,
} from '@codemirror/view'
import type { TagHit } from 'src/cli/serve/web/api.ts'
import {
   adjustWeight,
   completionCandidates,
   formatTag,
   promptMarks,
   TAG_CATEGORY_NAMES,
   tagIssues,
   toggleComment,
   toggleNegative,
   type PromptMarkKind,
   type TextChange,
} from 'src/vars/promptSyntax.ts'

export const WEIGHT_STEP = 0.05

/** what the editor needs from the form, read fresh on every use: the loras change while you type */
export type PromptEditorCtx = {
   weights: boolean
   tags: { underscores: boolean; artistPrefix?: string } | null
   searchTags: (q: string, signal: AbortSignal) => Promise<TagHit[]>
   injected: () => { tag: string; source: string }[]
   loraWords: () => { word: string; source: string }[]
   /** a tag list error, or null once a query works again */
   onTagError: (message: string | null) => void
}

/** dispatched when the context changed outside the document (a lora toggled): redo the marks */
export const refreshMarks = StateEffect.define<null>()

const MARK_CLASS: Record<PromptMarkKind, string> = {
   comment: 'pe-comment',
   negative: 'pe-negative',
   'negative-dash': 'pe-negative-dash',
   'weight-paren': 'pe-weight-paren',
   'weight-num': 'pe-weight-num',
}

function decorationsFor(view: EditorView, ctx: () => PromptEditorCtx): DecorationSet {
   const text = view.state.doc.toString()
   const c = ctx()
   const ranges = promptMarks(text)
      .filter((m) => m.to > m.from)
      .map((m) => Decoration.mark({ class: MARK_CLASS[m.kind] }).range(m.from, m.to))
   for (const issue of tagIssues(text, { injected: c.injected(), weights: c.weights }))
      if (issue.to > issue.from)
         ranges.push(
            Decoration.mark({ class: 'pe-issue', attributes: { 'data-tip': issue.message } }).range(
               issue.from,
               issue.to,
            ),
         )
   return Decoration.set(ranges, true)
}

function highlighter(ctx: () => PromptEditorCtx): Extension {
   return ViewPlugin.fromClass(
      class {
         decorations: DecorationSet
         constructor(view: EditorView) {
            this.decorations = decorationsFor(view, ctx)
         }
         update(u: ViewUpdate): void {
            const refreshed = u.transactions.some((t) => t.effects.some((e) => e.is(refreshMarks)))
            if (u.docChanged || refreshed) this.decorations = decorationsFor(u.view, ctx)
         }
      },
      { decorations: (v) => v.decorations },
   )
}

function applyChanges(view: EditorView, changes: TextChange[]): boolean {
   if (changes.length === 0) return false
   view.dispatch({ changes, userEvent: 'input' })
   return true
}

function weightCommand(ctx: () => PromptEditorCtx, delta: number): Command {
   return (view) => {
      if (!ctx().weights) return false
      const sel = view.state.selection.main
      const r = adjustWeight(view.state.doc.toString(), sel.from, sel.to, delta)
      if (r == null) return false
      view.dispatch({
         changes: r.changes,
         selection: EditorSelection.single(r.selection.anchor, r.selection.head),
         userEvent: 'input',
      })
      return true
   }
}

const lineCommand =
   (fn: (text: string, from: number, to: number) => TextChange[]): Command =>
   (view) => {
      const sel = view.state.selection.main
      return applyChanges(view, fn(view.state.doc.toString(), sel.from, sel.to))
   }

function promptKeymap(ctx: () => PromptEditorCtx): Extension {
   const up = weightCommand(ctx, WEIGHT_STEP)
   const down = weightCommand(ctx, -WEIGHT_STEP)
   const negative = lineCommand(toggleNegative)
   return Prec.high(
      keymap.of([
         // ⌘↑ on macOS (⌃↑ belongs to Mission Control there), ⌃↑ elsewhere, both everywhere
         { key: 'Mod-ArrowUp', run: up },
         { key: 'Ctrl-ArrowUp', run: up },
         { key: 'Mod-ArrowDown', run: down },
         { key: 'Ctrl-ArrowDown', run: down },
         { key: 'Mod-/', run: lineCommand(toggleComment) },
         { key: 'Mod-Shift--', run: negative },
         { key: 'Mod-_', run: negative },
         { key: 'Alt-ArrowUp', run: moveLineUp },
         { key: 'Alt-ArrowDown', run: moveLineDown },
      ]),
   )
}

const compactCount = (n: number): string =>
   n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

/** the insert: the tag, then `, ` unless a separator already follows */
function applyTag(insert: string): Completion['apply'] {
   return (view, _completion, from, to) => {
      const next = view.state.sliceDoc(to, to + 1)
      const tail = next === '' || next === '\n' ? ', ' : ''
      view.dispatch({
         changes: { from, to, insert: insert + tail },
         selection: { anchor: from + insert.length + tail.length },
         userEvent: 'input.complete',
      })
   }
}

/** the options for one search text: lora words containing it, then the tag list's hits */
async function optionsFor(c: PromptEditorCtx, text: string, signal: AbortSignal): Promise<Completion[]> {
   const q = text.trim().toLowerCase()
   const options: Completion[] = []
   const seenWords = new Set<string>()
   for (const w of c.loraWords()) {
      const lower = w.word.toLowerCase()
      if (seenWords.has(lower) || (q !== '' && !lower.includes(q))) continue
      seenWords.add(lower)
      options.push({ label: w.word, detail: w.source, type: 'lora', boost: 50, apply: applyTag(w.word) })
   }
   if (c.tags == null || q === '') return options
   const hits = await c.searchTags(text.trim(), signal)
   c.onTagError(null)
   hits.forEach((h, ix) => {
      const insert = formatTag(h.name, h.category, { ...c.tags, weights: c.weights })
      options.push({
         label: insert,
         detail: `${h.alias == null ? '' : `← ${h.alias} · `}${compactCount(h.count)}`,
         type: `tag-${TAG_CATEGORY_NAMES[h.category ?? -1] ?? 'plain'}`,
         boost: -ix,
         apply: applyTag(insert),
      })
   })
   return options
}

function completionSource(ctx: () => PromptEditorCtx) {
   return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const line = context.state.doc.lineAt(context.pos)
      const c = ctx()
      const abort = new AbortController()
      context.addEventListener('abort', () => abort.abort())
      // the whole chunk first, then its last words: the first one that finds something wins
      for (const cand of completionCandidates(line.text, context.pos - line.from)) {
         if (cand.text.trim().length < 2 && !context.explicit) continue
         try {
            const options = await optionsFor(c, cand.text, abort.signal)
            if (options.length > 0) return { from: line.from + cand.from, options, filter: false }
         } catch (e) {
            if (abort.signal.aborted) return null
            c.onTagError(e instanceof Error ? e.message : String(e))
            return null
         }
      }
      return null
   }
}

const theme = EditorView.theme(
   {
      '&': {
         background: 'var(--panel-2)',
         border: '1px solid var(--border)',
         borderRadius: '6px',
         color: 'var(--text)',
         fontSize: '13px',
      },
      '&.cm-focused': { outline: 'none', borderColor: 'var(--accent)' },
      '.cm-scroller': {
         fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
         lineHeight: '1.5',
         maxHeight: '18em',
         overflow: 'auto',
      },
      '.cm-content': { padding: '6px 0', caretColor: 'var(--text)' },
      '.cm-line': { padding: '0 8px' },
      '.cm-cursor': { borderLeftColor: 'var(--text)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
         background: 'var(--accent-dim) !important',
      },
      '.cm-placeholder': { color: 'var(--dim)' },
      '.pe-comment': { color: 'var(--dim)', fontStyle: 'italic' },
      '.pe-comment *': { color: 'var(--dim)' },
      '.pe-negative': { color: 'var(--red)' },
      '.pe-negative-dash': { color: 'var(--red)', fontWeight: '700' },
      '.pe-weight-paren': { opacity: '0.45' },
      '.pe-weight-num': { color: 'var(--amber)', fontWeight: '700' },
      '.pe-issue': { textDecoration: 'underline wavy var(--amber)', textUnderlineOffset: '3px' },
      '.cm-tooltip.cm-tooltip-autocomplete': {
         background: 'var(--panel)',
         border: '1px solid var(--border)',
         borderRadius: '6px',
         overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '16em' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px', display: 'flex', gap: '10px' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent-dim)', color: '#fff' },
      '.cm-completionDetail': { marginLeft: 'auto', color: 'var(--dim)', fontStyle: 'normal' },
      '.cm-completionIcon': { display: 'none' },
      '.cm-completionLabel': { whiteSpace: 'nowrap' },
      // danbooru category colors, the ones every booru site uses
      '.cm-completionIcon-tag-artist + .cm-completionLabel': { color: '#ff8a8b' },
      '.cm-completionIcon-tag-copyright + .cm-completionLabel': { color: '#c797ff' },
      '.cm-completionIcon-tag-character + .cm-completionLabel': { color: '#35c64a' },
      '.cm-completionIcon-tag-meta + .cm-completionLabel': { color: '#ead084' },
      '.cm-completionIcon-lora + .cm-completionLabel': { color: 'var(--accent)' },
   },
   { dark: true },
)

/** ⌘⏎ is the panel's generate, from any focus: the default keymap's own ⌘⏎ is left out */
const baseKeymap = defaultKeymap.filter((b) => b.key !== 'Mod-Enter')

export function promptExtensions(p: {
   ctx: () => PromptEditorCtx
   onChange: (text: string) => void
   /** the box never gets shorter than this, so an empty prompt still looks like a box */
   minLines: number
   placeholder?: string
}): Extension[] {
   return [
      EditorView.theme({ '.cm-content': { minHeight: `${p.minLines * 1.5}em` } }),
      history(),
      promptKeymap(p.ctx),
      keymap.of([...baseKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      highlighter(p.ctx),
      autocompletion({ override: [completionSource(p.ctx)], icons: true, activateOnTyping: true }),
      theme,
      placeholder(p.placeholder ?? ''),
      EditorView.updateListener.of((u) => {
         if (u.docChanged) p.onChange(u.state.doc.toString())
      }),
   ]
}
