import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { AppSt } from './state.ts'

const st = new AppSt()
// console debugging path (app-state-tree: expose the root)
;(globalThis as { st?: AppSt }).st = st
void st.boot()

const rootEl = document.getElementById('root')
if (rootEl == null) throw new Error('#root missing from index.html')
createRoot(rootEl).render(<App st={st} />)
