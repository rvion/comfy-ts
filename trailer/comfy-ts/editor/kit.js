// what every editor take shares: Monaco (VS Code's editor) with the real TypeScript service over the published
// comfy-ts types, the cut's look, keystrokes on a timeline, and window.__trailerStep(t), which plays the keystrokes due
// by t and returns once the editor shows them. A take file (take.js, app.js) gives its code and its events.
const BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2'
const mark = (s) => document.querySelector('meta[name=shot-ready]').setAttribute('content', s)
self.MonacoEnvironment = {
   getWorkerUrl: () =>
      'data:text/javascript;charset=utf-8,' +
      encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${BASE}/min/'};importScripts('${BASE}/min/vs/base/worker/workerMain.js');`),
}
require.config({ paths: { vs: `${BASE}/min/vs` } })

let editor, model, worker
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
const offsetOf = (s) => model.getValue().indexOf(s)
const at = (offset) => editor.setPosition(model.getPositionAt(offset))
/** one keystroke an event, `step` seconds apart from t0 */
const keys = (t0, step, text) => [...text].map((ch, i) => ({ t: t0 + i * step, run: async () => type(ch) }))

async function pick(name) {
   for (let i = 0; i < 60 && focused() !== name; i++) {
      cmd('selectNextSuggestion')
      await sleep(10)
   }
   if (focused() !== name) throw new Error(`editor take: no completion named ${name} (focused: ${focused()})`)
}

/** the step hook over a take's events; `stretch` maps an event's written time onto the cut's clock */
function playEvents(events, stretch = 1) {
   let next = 0
   window.__trailerStep = async (t) => {
      while (next < events.length && events[next].t * stretch <= t + 1e-6) {
         await events[next].run()
         next++
         await sleep(30)
      }
      await sleep(40)
   }
}

/** opens the editor on `code` with the given type files, warms the worker, then runs `ready` before the first frame */
function openTake({ code, file, libs, options = {}, ready }) {
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
         const texts = await Promise.all(Object.keys(libs).map((u) => fetch(u).then((r) => r.text())))
         Object.values(libs).forEach((path, i) => d.addExtraLib(texts[i], path))
         await document.fonts.ready
         monaco.editor.defineTheme('trailer', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: { 'editor.background': '#0f1a2e', 'editor.lineHighlightBackground': '#14223a', 'editorSuggestWidget.background': '#13213a', 'editorSuggestWidget.selectedBackground': '#1f3a66', 'editorHoverWidget.background': '#13213a' },
         })
         document.querySelector('#tabs .tab').textContent = file
         model = monaco.editor.createModel(code, 'typescript', monaco.Uri.parse(`file:///${file}`))
         editor = monaco.editor.create(document.getElementById('editor'), {
            model,
            theme: 'trailer',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 19,
            suggestFontSize: 17,
            suggestLineHeight: 26,
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
            parameterHints: { enabled: false },
            hover: { delay: 0, sticky: true },
            renderValidationDecorations: 'on',
            ...options,
         })
         monaco.editor.remeasureFonts()
         editor.focus()
         worker = await (await ts.getTypeScriptWorker())(model.uri)
         await worker.getSemanticDiagnostics(model.uri.toString())
         await ready()
         mark('ready')
      } catch (e) {
         document.body.insertAdjacentHTML('beforeend', `<pre style="position:absolute;top:0;left:0;color:#f66;font:14px monospace;z-index:9">${String(e?.stack ?? e)}</pre>`)
         window.__probe = { error: String(e) }
         window.__trailerStep = async () => {
            throw e
         }
         mark('ready')
      }
   })
}
