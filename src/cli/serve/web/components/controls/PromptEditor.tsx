// one prompt box: a CodeMirror editor over a plain string. The value stays controlled (a preset
// pick or a draft switch replaces the text), and the footer says what the editor cannot color
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState } from 'react'
import { fetchTags } from 'src/cli/serve/web/api.ts'
import {
   promptExtensions,
   refreshMarks,
   WEIGHT_STEP,
   type PromptEditorCtx,
} from 'src/cli/serve/web/promptEditor/promptExtensions.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'
import { estimateTokens } from 'src/vars/promptSyntax.ts'

const KEYS_TIP = [
   `⌘↑ / ⌘↓ (or ⌃↑ / ⌃↓): weight of the selection or the tag under the cursor, ±${WEIGHT_STEP}`,
   '⌘/ comment lines · ⌘⇧- negative lines · ⌥↑ / ⌥↓ move lines',
   '"//" starts a comment · "- " line = negative prompt · ⌘⏎ generate',
].join('\n')

export const PromptEditor = observer(function PromptEditor(p: {
   v: VarSt
   st: WebSt
   module: string
   value: string
   onChange: (text: string) => void
   minLines: number
}) {
   const host = useRef<HTMLDivElement>(null)
   const view = useRef<EditorView | null>(null)
   const [tagError, setTagError] = useState<string | null>(null)
   // the editor reads these through a getter, so it sees the latest without being rebuilt
   const latest = useRef({ p, setTagError })
   latest.current = { p, setTagError }
   const form = p.st.form
   const injectedKey = JSON.stringify(form?.injectedTagsFor(p.v) ?? [])

   useEffect(() => {
      const ctx = (): PromptEditorCtx => {
         const cur = latest.current.p
         const f = cur.st.form
         return {
            weights: cur.v.desc.weights !== false,
            tags: cur.v.desc.tags ?? null,
            searchTags: async (q, signal) =>
               (await fetchTags({ module: cur.module, varName: cur.v.name, q, signal })).hits,
            injected: () => f?.injectedTagsFor(cur.v) ?? [],
            loraWords: () => f?.loraWordsFor(cur.v) ?? [],
            onTagError: (m) => latest.current.setTagError(m),
         }
      }
      if (host.current == null) return
      const v = new EditorView({
         parent: host.current,
         state: EditorState.create({
            doc: latest.current.p.value,
            extensions: promptExtensions({
               ctx,
               onChange: (text) => latest.current.p.onChange(text),
               minLines: latest.current.p.minLines,
            }),
         }),
      })
      view.current = v
      return () => {
         v.destroy()
         view.current = null
      }
   }, [])

   // controlled: a value that changed from outside (preset, draft, revert) replaces the text
   useEffect(() => {
      const v = view.current
      if (v == null) return
      const doc = v.state.doc.toString()
      if (doc === p.value) return
      const head = Math.min(v.state.selection.main.head, p.value.length)
      v.dispatch({ changes: { from: 0, to: doc.length, insert: p.value }, selection: { anchor: head } })
   }, [p.value])

   // a lora switched on or off moves which tags count as already added
   useEffect(() => {
      view.current?.dispatch({ effects: refreshMarks.of(null) })
   }, [injectedKey])

   const tokens = estimateTokens(p.value)
   return (
      <div className="prompt-editor">
         <div ref={host} />
         <div className="pe-foot">
            {tagError == null ? null : (
               <span className="pe-error" data-tip={tagError}>
                  tags: {tagError}
               </span>
            )}
            <span className="pe-keys" data-tip={KEYS_TIP}>
               keys
            </span>
            <span
               className="pe-tokens"
               data-tip={'an estimate of the CLIP tokens the positive prompt uses\nCLIP models read it in chunks of 75'}
            >
               ≈ {tokens} tokens
            </span>
         </div>
      </div>
   )
})
