import { Text } from 'ink'
import { observer } from 'mobx-react-lite'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

const EDIT_WINDOW = 56

/** inline single-line editor rendering (numbers, custom prompts) */
export const EditField = observer((p: { st: TuiSt }) => {
   const ed = p.st.editor
   // code-point slicing (cursor counts code points, see EditorSt.cursor)
   const cs = [...ed.buffer]
   // sliding window so the caret stays visible in long buffers
   const windowStart = Math.max(0, Math.min(ed.cursor - Math.floor(EDIT_WINDOW * 0.7), cs.length - EDIT_WINDOW))
   const before = cs.slice(windowStart, ed.cursor).join('')
   const at = cs[ed.cursor] ?? ' '
   const after = cs.slice(ed.cursor + 1, windowStart + EDIT_WINDOW).join('')
   const color = ed.invalid ? 'red' : 'yellow'
   return (
      <Text color={color}>
         {windowStart > 0 ? '…' : ''}
         {before}
         <Text inverse>{at}</Text>
         {after}
         {windowStart + EDIT_WINDOW < cs.length ? '…' : ''}
      </Text>
   )
})
