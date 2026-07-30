import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** persistent left panel: workflows with their drafts nested; `t` (or ← from vars) focuses it */
export const TreePanel = observer((p: { st: TuiSt }) => {
   const s = p.st
   const tree = s.tree
   const focused = s.mode === 'tree'
   return (
      <Box
         borderStyle="round"
         borderColor={focused ? 'cyan' : 'gray'}
         flexDirection="column"
         flexShrink={0}
         width={s.treeWidth}
         paddingX={1}
      >
         {/* marginTop -1 lifts the label onto the border line: the panel key IS its title */}
         <Box marginTop={-1}>
            <Text color={focused ? 'cyan' : 'gray'} bold={focused}>
               (t)ree
            </Text>
         </Box>
         {tree.rows.map((row, ix) => {
            const sel = focused && ix === tree.ix
            if (row.kind === 'section') {
               return (
                  <Text key={`section·${row.label}`} color="gray" dimColor wrap="truncate">
                     ─ {row.label}
                  </Text>
               )
            }
            if (row.kind === 'workflow') {
               const arrow = row.hasDrafts ? (row.expanded ? '▾' : '▸') : ' '
               const marker = row.error != null ? '✗' : row.current ? '●' : ' '
               return (
                  <Text
                     key={row.file}
                     inverse={sel}
                     color={row.error != null ? 'red' : row.current ? 'green' : undefined}
                     wrap="truncate"
                  >
                     {arrow}
                     {marker} {row.name}
                  </Text>
               )
            }
            return (
               <Text
                  key={`${row.file}·${row.draft}`}
                  inverse={sel}
                  color={row.active ? 'cyan' : 'gray'}
                  wrap="truncate"
               >
                  {'   '}
                  {row.active ? '●' : '·'} {row.draft}
               </Text>
            )
         })}
         {s.workflows.loading ? <Text color="yellow">loading…</Text> : null}
      </Box>
   )
})
