// the editor take: Monaco (VS Code's editor) with the real TypeScript service over the published comfy-ts types and the
// public Comfy Cloud catalog. Every completion and the error are computed by the worker, never drawn.
// window.__trailerStep(t) plays the keystrokes due by t and returns once the editor shows them.
const BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2'
const mark = (s) => document.querySelector('meta[name=shot-ready]').setAttribute('content', s)
self.MonacoEnvironment = {
   getWorkerUrl: () =>
      'data:text/javascript;charset=utf-8,' +
      encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${BASE}/min/'};importScripts('${BASE}/min/vs/base/worker/workerMain.js');`),
}
require.config({ paths: { vs: `${BASE}/min/vs` } })

const CODE = [
   `import { ComfyTS } from 'comfy-ts'`,
   `const host = ComfyTS.create().host({ id: 'comfy-cloud', url: 'https://cloud.comfy.org' })`,
   ``,
   `export const poster = host.defineWorkflow({`,
   `   id: 'poster', vars: {},`,
   `   build: (b) => {`,
   `      const ckpt = b`,
   `   },`,
   `})`,
].join('\n')
const CURSOR_LINE = 7

let editor, model
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(pred, what, ms = 20000) {
   const t0 = performance.now()
   while (!pred()) {
      if (performance.now() - t0 > ms) throw new Error(`editor take: ${what} never came`)
      await sleep(15)
   }
}
const rows = () => [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')]
const label = (row) => row?.querySelector('.label-name')?.textContent ?? ''
const focused = () => label(document.querySelector('.suggest-widget.visible .monaco-list-row.focused'))
const type = (text) => editor.trigger('keyboard', 'type', { text })
const cmd = (id) => editor.trigger('keyboard', id, {})
const errors = () => monaco.editor.getModelMarkers({ resource: model.uri }).filter((m) => m.severity === monaco.MarkerSeverity.Error)

async function pick(name) {
   for (let i = 0; i < 60 && focused() !== name; i++) {
      cmd('selectNextSuggestion')
      await sleep(10)
   }
   if (focused() !== name) throw new Error(`editor take: no completion named ${name} (focused: ${focused()})`)
}
async function typeSlow(text) {
   for (const ch of text) type(ch)
}
const offsetOf = (s) => model.getValue().indexOf(s)
const at = (offset) => editor.setPosition(model.getPositionAt(offset))

// the beats, written on a 2.18 s bar and stretched to the cut's bar (tempo 100: 2.4 s); each runs once, in order
const STRETCH = 2.4 / (240 / 110)
const keys = (t0, step, text) => [...text].map((ch, i) => ({ t: t0 + i * step, run: async () => type(ch) }))
const EVENTS = [
   // hook: the node list is open on frame 0 and pages down, then narrows to the checkpoint loader
   ...[0.3, 0.6, 0.9, 1.2, 1.5, 1.8].map((t) => ({ t, run: async () => cmd('selectNextPageSuggestion') })),
   ...keys(2.2, 0.12, 'Check'),
   { t: 2.85, run: async () => pick('CheckpointLoaderSimple') },
   { t: 3.2, run: async () => cmd('acceptSelectedSuggestion') },
   // models: the checkpoint names of the catalog
   ...keys(3.45, 0.055, "({ ckpt_name: '"),
   { t: 4.3, run: async () => { cmd('editor.action.triggerSuggest'); await until(() => rows().length > 0, 'the model list') } },
   ...[4.8, 5.2, 5.6, 6.0].map((t) => ({ t, run: async () => cmd('selectNextPageSuggestion') })),
   ...keys(6.4, 0.1, 'Dream'),
   { t: 6.95, run: async () => pick('DreamShaper_8_pruned.safetensors') },
   { t: 7.3, run: async () => cmd('acceptSelectedSuggestion') },
   { t: 7.55, run: async () => type("'") },
   { t: 7.65, run: async () => type(' ') },
   // typo: drop "_pruned", the worker flags it, its message shows
   { t: 8.75, run: async () => at(offsetOf('_pruned') + '_pruned'.length) },
   ...[8.85, 8.92, 8.99, 9.06, 9.13, 9.2, 9.27].map((t) => ({ t, run: async () => cmd('deleteLeft') })),
   { t: 9.3, run: async () => until(() => errors().length > 0, 'the type error') },
   {
      t: 9.9,
      run: async () => {
         at(offsetOf("'DreamShaper") + 4)
         cmd('editor.action.showHover')
         await until(() => /not assignable/.test(document.querySelector('.monaco-hover:not(.hidden)')?.textContent ?? ''), 'the error hover')
      },
   },
]
let next = 0

window.__trailerStep = async (t) => {
   while (next < EVENTS.length && EVENTS[next].t * STRETCH <= t + 1e-6) {
      await EVENTS[next].run()
      next++
      await sleep(30)
   }
   await sleep(40)
}

require(['vs/editor/editor.main'], async () => {
   try {
      const ts = monaco.languages.typescript
      const d = ts.typescriptDefaults
      d.setCompilerOptions({
         target: ts.ScriptTarget.ES2022,
         module: ts.ModuleKind.ESNext,
         moduleResolution: ts.ModuleResolutionKind.NodeJs,
         strict: true,
         noEmit: true,
         skipLibCheck: true,
         allowNonTsExtensions: true,
      })
      d.setEagerModelSync(true)
      const [lib, sdk] = await Promise.all(['/lib/comfy-ts.d.ts', '/lib/cloud-sdk.d.ts'].map((u) => fetch(u).then((r) => r.text())))
      d.addExtraLib(lib, 'file:///node_modules/comfy-ts/index.d.ts')
      d.addExtraLib(sdk, 'file:///comfy-cloud/sdk.d.ts')
      await document.fonts.ready
      monaco.editor.defineTheme('trailer', {
         base: 'vs-dark',
         inherit: true,
         rules: [],
         colors: { 'editor.background': '#0f1a2e', 'editor.lineHighlightBackground': '#14223a', 'editorSuggestWidget.background': '#13213a', 'editorSuggestWidget.selectedBackground': '#1f3a66', 'editorHoverWidget.background': '#13213a' },
      })
      model = monaco.editor.createModel(CODE, 'typescript', monaco.Uri.parse('file:///poster.cflow.ts'))
      editor = monaco.editor.create(document.getElementById('editor'), {
         model,
         theme: 'trailer',
         fontFamily: "'JetBrains Mono', monospace",
         fontSize: 19,
         lineHeight: 30,
         minimap: { enabled: false },
         scrollBeyondLastLine: false,
         overviewRulerLanes: 0,
         cursorBlinking: 'solid',
         padding: { top: 14 },
         quickSuggestions: false,
         wordBasedSuggestions: 'off',
         suggest: { showWords: false, preview: false, showStatusBar: false, showInlineDetails: false },
         fixedOverflowWidgets: true,
         hover: { delay: 0, sticky: true },
         renderValidationDecorations: 'on',
      })
      monaco.editor.remeasureFonts()
      editor.focus()
      // warm the worker over both type files, and check the builder is the catalog's
      const worker = await (await ts.getTypeScriptWorker())(model.uri)
      await worker.getSemanticDiagnostics(model.uri.toString())
      editor.setPosition({ lineNumber: CURSOR_LINE, column: model.getLineMaxColumn(CURSOR_LINE) })
      type('.')
      await until(() => rows().length > 0, 'the node list')
      const probe = await worker.getCompletionsAtPosition(model.uri.toString(), model.getOffsetAt(editor.getPosition()))
      window.__probe = { completions: probe?.entries?.length ?? 0, first: rows().map(label).slice(0, 5) }
      if ((probe?.entries?.length ?? 0) < 1000) throw new Error(`editor take: b. lists ${probe?.entries?.length} names, the catalog builder did not resolve`)
      mark('ready')
   } catch (e) {
      document.body.insertAdjacentHTML('beforeend', `<pre style="position:absolute;top:0;left:0;color:#f66;font:14px monospace;z-index:9">${String(e?.stack ?? e)}</pre>`)
      window.__probe = { error: String(e) }
      mark('ready')
   }
})
