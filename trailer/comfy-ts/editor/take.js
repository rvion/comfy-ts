// the types take: autocomplete over the public Comfy Cloud catalog, a model name picked, then a typo the worker flags.
// Every completion and the error are computed by the TypeScript worker, never drawn.
const CODE = [
   `import { ComfyTS } from 'comfy-ts'`,
   `const host = ComfyTS.create().host({ id: 'comfy-cloud', url: 'https://cloud.comfy.org' })`,
   `export const poster = host.defineWorkflow({ id: 'poster', vars: {},`,
   `   build: (b) => {`,
   `      const ckpt = b`,
   `   },`,
   `})`,
].join('\n')
const CURSOR_LINE = 5

// the beats, written on a 2.18 s bar and stretched to the cut's bar (tempo 100: 2.4 s); each runs once, in order
const STRETCH = 2.4 / (240 / 110)
playEvents(
   [
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
            at(offsetOf('ckpt_name') + 3)
            cmd('editor.action.showHover')
            await until(() => /not assignable/.test(document.querySelector('.monaco-hover:not(.hidden)')?.textContent ?? ''), 'the error hover')
         },
      },
   ],
   STRETCH,
)

openTake({
   code: CODE,
   file: 'poster.cflow.ts',
   libs: { '/lib/comfy-ts.d.ts': 'file:///node_modules/comfy-ts/index.d.ts', '/lib/cloud-sdk.d.ts': 'file:///comfy-cloud/sdk.d.ts' },
   ready: async () => {
      // the node list open on frame 0, and the builder checked to be the catalog's
      editor.setPosition({ lineNumber: CURSOR_LINE, column: model.getLineMaxColumn(CURSOR_LINE) })
      type('.')
      await until(() => rows().length > 0, 'the node list')
      const probe = await worker.getCompletionsAtPosition(model.uri.toString(), model.getOffsetAt(editor.getPosition()))
      window.__probe = { completions: probe?.entries?.length ?? 0, first: rows().map(label).slice(0, 5) }
      if ((probe?.entries?.length ?? 0) < 300) throw new Error(`editor take: b. lists ${probe?.entries?.length} names, the catalog builder did not resolve`)
   },
})
