import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** host stats + maintenance actions (mode 'host', key `h`) */
export const HostPanel = observer((p: { st: TuiSt }) => {
   const s = p.st
   const h = s.host
   return (
      <Box borderStyle="double" paddingX={1} flexDirection="column">
         <Text bold>
            host · <Text color="green">{h.host.data.id}</Text>{' '}
            <Text color="gray">
               ({h.host.data.host}:{h.host.data.port})
            </Text>
         </Text>
         {h.stats.map((row) => (
            <Text key={row.label}>
               <Text color="gray">{row.label.padEnd(12)}</Text>
               {row.value}
            </Text>
         ))}
         <Text> </Text>
         {h.actions.map((action, ix) => {
            const sel = ix === h.ix
            const busy = h.running === action.key
            return (
               <Text key={action.key} inverse={sel} color={busy ? 'yellow' : undefined}>
                  {sel ? '▸ ' : '  '}
                  {action.label}
                  {busy ? ' …' : ''}
               </Text>
            )
         })}
      </Box>
   )
})
