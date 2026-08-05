import { Box, Text } from 'ink'
import { observer } from 'src/cli/tui/mobxCompat.ts'
import type { ReactNode } from 'react'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

const HeaderBox = (p: { title?: string; children: ReactNode }): ReactNode => (
   <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" flexShrink={0}>
      {p.title != null && (
         // marginTop -1 lifts the label onto the border line: the box key IS its title
         <Box marginTop={-1}>
            <Text color="gray">{p.title}</Text>
         </Box>
      )}
      <Box>{p.children}</Box>
   </Box>
)

/** labeled header boxes: brand · (w)orkflow · (d)raft · (h)ost·(a)ctions — the keys open each surface */
export const Header = observer((p: { st: TuiSt }) => {
   const s = p.st
   const runHost = s.runHost
   return (
      <Box flexDirection="row">
         <HeaderBox>
            <Text bold color="magenta">
               comfy-ts
            </Text>
         </HeaderBox>
         <HeaderBox title="(w)orkflow">
            <Text bold color="yellow">
               {s.wf.spec.id ?? 'workflow'}
            </Text>
         </HeaderBox>
         <HeaderBox title="(d)raft">
            <Text bold color="cyan">
               {s.drafts.active ?? 'default'}
            </Text>
         </HeaderBox>
         <HeaderBox title="(h)ost · (a)ctions">
            <Text>
               <Text color={s.host.status === 'up' ? 'green' : s.host.status === 'down' ? 'red' : 'gray'}>● </Text>
               <Text bold color="green">
                  {runHost.data.id}
               </Text>
               <Text color="gray">
                  {' '}
                  ({runHost.base.host}:{runHost.base.port})
               </Text>
               {/* the override must stay loud: every run bypasses the workflow's own host */}
               {s.hostOverride != null && s.hostOverride !== s.wf.host && (
                  <Text color="yellow"> ⇄ overrides {s.wf.host.data.id}</Text>
               )}
               {/* while down, show the probe loop living: spinner in flight, countdown between tries */}
               {s.host.status === 'down' && (
                  <Text color="red"> {s.host.probing ? s.host.spinner : `↻ ${s.host.retryInS}s`}</Text>
               )}
            </Text>
         </HeaderBox>
      </Box>
   )
})
