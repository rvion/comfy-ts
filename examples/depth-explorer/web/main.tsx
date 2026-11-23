import { createRoot } from 'react-dom/client'
import { WIDGET_STYLES } from '../../../src/cli/serve/web/widgets/widgetStyles.ts'
import { App } from './App.tsx'
import { AppSt } from './state.ts'

// the panel's output widget rules (the relight view is the panel's widget)
const styleEl = document.createElement('style')
styleEl.textContent = WIDGET_STYLES
document.head.appendChild(styleEl)

const st = new AppSt()
// console debugging path (app-state-tree: expose the root)
;(globalThis as { st?: AppSt }).st = st
Object.assign(window, { tour: (t: number) => st.tour(t) })
void st.boot()

const rootEl = document.getElementById('root')
if (rootEl == null) throw new Error('#root missing from index.html')
createRoot(rootEl).render(<App st={st} />)
