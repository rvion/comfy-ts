// the last failed run, in full: ComfyUI's message names the node and often a file path, so it
// wraps instead of being cut to one line. Under the prompt preview, where the eye is after a run
import { observer } from 'mobx-react-lite'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export const RunError = observer(function RunError(p: { st: WebSt }) {
   const error = p.st.run.error
   if (error == null) return null
   return (
      <div className="run-error-block" role="alert">
         <Icon name="warn" />
         <pre className="run-error-text">{error}</pre>
         <button type="button" className="link danger" data-tip="dismiss" onClick={() => p.st.run.dismissError()}>
            <Icon name="close" />
         </button>
      </div>
   )
})
