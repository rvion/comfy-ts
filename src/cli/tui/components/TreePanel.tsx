import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** persistent left panel: directory hierarchy + workflows with their drafts
 * nested; `t` (or ← from vars) focuses it, `/` filters it */
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
         {(tree.filtering || tree.filter !== '') && (
            <Text color="yellow" wrap="truncate">
               /{tree.filter}
               {tree.filtering ? '▌' : ''}
            </Text>
         )}
         {tree.rows.map((row, ix) => {
            const sel = focused && ix === tree.ix
            const indent = ' '.repeat(row.depth * 2)
            if (row.kind === 'dir') {
               return (
                  <Text key={`dir·${row.path}`} inverse={sel} color="gray" bold wrap="truncate">
                     {indent}
                     {row.expanded ? '▾' : '▸'} {row.label}
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
                     bold={row.current}
                     color={row.error != null ? 'red' : row.color}
                     wrap="truncate"
                  >
                     {indent}
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
                  {indent} {row.active ? '●' : '·'} {row.draft}
               </Text>
            )
         })}
         {s.workflows.loading ? <Text color="yellow">loading…</Text> : null}
      </Box>
   )
})
