import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import { KeyHints } from 'src/cli/tui/components/StatusBar.tsx'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** `c`/`C` confirmation popup: WHAT landed in the clipboard (or the loud
 * failure) — a copy is never silent again. ⏎/esc closes. */
export const CopyOverlay = observer((p: { st: TuiSt }) => {
   const popup = p.st.exec.copyPopup
   if (popup == null) return null
   return (
      <Box borderStyle="double" borderColor={popup.ok ? 'green' : 'red'} paddingX={1} flexDirection="column">
         <Text bold color={popup.ok ? 'green' : 'red'}>
            {popup.ok ? '✓ ' : '✗ '}
            {popup.title}
         </Text>
         {popup.lines.slice(0, p.st.overlayLines).map((line, ix) => (
            <Text key={`${ix}·${line.slice(0, 12)}`} color={popup.ok ? undefined : 'red'} wrap="truncate">
               {line}
            </Text>
         ))}
         <KeyHints hints={[['⏎/esc', 'close']]} />
      </Box>
   )
})
