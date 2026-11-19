// the hosts take: one live host line and three commented beside it, in the forms the README teaches; the live line
// moves down the list (local, LAN, cloud, a provider) while the workflow under it stays the same
const HOSTS = [
   `const host = comfy.host({ id: 'my-gpu' })`,
   `const host = comfy.host({ id: 'gpu-tower', host: '192.168.1.5', port: 8188 })`,
   `const host = comfy.host({ id: 'comfy-cloud', url: 'https://cloud.comfy.org', apiKey: process.env.COMFY_CLOUD_API_KEY })`,
   `const host = comfy.host({ id: 'runpod', url: 'https://xxxx-8188.proxy.runpod.net' })`,
]
const NOTES = ['// your GPU: the address comfy-ts gen saved', '// a box on your network', '// Comfy Cloud', '// any provider']
const FIRST = 3
const CODE = [
   `import { ComfyTS } from 'comfy-ts'`,
   `const comfy = ComfyTS.create()`,
   ``,
   ...HOSTS.flatMap((h, i) => [NOTES[i], i === 0 ? h : `// ${h}`]),
   ``,
   `export const scenery = host.defineWorkflow({ id: 'scenery', vars: {}, build: (b) => { /* the same graph */ } })`,
].join('\n')

/** comments every host line but the i-th */
function live(i) {
   const edits = HOSTS.map((h, k) => {
      const line = FIRST + 2 + 2 * k
      return { range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)), text: k === i ? h : `// ${h}` }
   })
   editor.executeEdits('take', edits)
   editor.setPosition({ lineNumber: FIRST + 2 + 2 * i, column: 1 })
}

playEvents([1.2, 2.4, 3.6].map((t, i) => ({ t, run: async () => live(i + 1) })))
openTake({
   code: CODE,
   file: 'scenery.cflow.ts',
   libs: { '/lib/comfy-ts.d.ts': 'file:///node_modules/comfy-ts/index.d.ts' },
   options: { fontSize: 15.5, lineHeight: 24, quickSuggestions: false, suggestOnTriggerCharacters: false },
   ready: async () => editor.setPosition({ lineNumber: FIRST + 2, column: 1 }),
})
