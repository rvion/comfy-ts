// browser entry: inject the stylesheet, mount the root store + app
import { createRoot } from 'react-dom/client'
import { App } from 'src/cli/serve/web/components/App.tsx'
import { WebSt } from 'src/cli/serve/web/state/WebSt.ts'
import { STYLES } from 'src/cli/serve/web/styles.ts'

const styleEl = document.createElement('style')
styleEl.textContent = STYLES
document.head.appendChild(styleEl)

const st = new WebSt()
// console debugging path (app-state-tree: expose the root) — globalThis probe,
// agent/coding.md cast whitelist family 3
;(globalThis as { webst?: WebSt }).webst = st

const rootEl = document.getElementById('root')
if (rootEl == null) throw new Error('[serve web] #root element missing from the shell html')
createRoot(rootEl).render(<App st={st} />)
