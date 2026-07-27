import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

const ERROR_RE = /error|exception|traceback|failed/i

/** last server console lines (LogsSt), below the vars panel */
export const LogsPanel = observer((p: { st: TuiSt }) => {
   const rows = p.st.logs.tail(p.st.termRows < 30 ? 4 : 8)
   if (rows.length === 0) return null
   return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" flexShrink={0}>
         <Box marginTop={-1}>
            <Text color="gray">logs</Text>
         </Box>
         {rows.map((line, ix) => (
            <Text key={ix} color={ERROR_RE.test(line) ? 'red' : 'gray'} wrap="truncate-end">
               {line}
            </Text>
         ))}
      </Box>
   )
})
