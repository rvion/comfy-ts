import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import { EditField } from 'src/cli/tui/components/EditField.tsx'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** modal name prompt: renders any EditorSt CUSTOM session (new/rename/duplicate draft, …) */
export const PromptOverlay = observer((p: { st: TuiSt }) => {
   const ed = p.st.editor
   return (
      <Box borderStyle="double" paddingX={1} flexDirection="column">
         <Text bold>{ed.customTitle}</Text>
         <EditField st={p.st} />
         <Text color="gray">⏎ apply · esc cancel</Text>
      </Box>
   )
})
