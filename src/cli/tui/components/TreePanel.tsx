import { Box, measureElement, Text } from 'ink'
import { observer } from 'src/cli/tui/mobxCompat.ts'
import { useEffect, useRef } from 'react'
import type { DOMElement } from 'ink'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** persistent left panel: directory hierarchy + workflows with their drafts
 * nested; `t` (or ← from vars) focuses it, `/` filters it. The Box is
 * measured (keybar wraps, chrome height is width-dependent — arithmetic
 * lies) and the row list windows to the measured budget; overflow hidden
 * is the backstop for the one pre-measure frame. */
export const TreePanel = observer((p: { st: TuiSt }) => {
   const s = p.st
   const tree = s.tree
   const focused = s.mode === 'tree'
   const boxRef = useRef<DOMElement>(null)
   useEffect(() => {
      if (boxRef.current != null) tree.setViewH(measureElement(boxRef.current).height)
   })
   return (
      <Box
         ref={boxRef}
         borderStyle="round"
         borderColor={focused ? 'cyan' : 'gray'}
         flexDirection="column"
         flexShrink={0}
         width={s.treeWidth}
         paddingX={1}
         overflow="hidden"
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
         {tree.window.moreAbove && <Text color="gray">…</Text>}
         {tree.rows.slice(tree.window.start, tree.window.end).map((row, sliceIx) => {
            const ix = tree.window.start + sliceIx
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
         {tree.window.moreBelow && <Text color="gray">…</Text>}
         {s.workflows.loading ? <Text color="yellow">loading…</Text> : null}
      </Box>
   )
})
