import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import { OverlayList } from 'src/cli/tui/components/OverlayList.tsx'
import { PICKER_PANES } from 'src/cli/tui/imagePicker/ImagePickerSt.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** modal image browser: three panes (tab), dirs enter, ⏎ picks, ★ = favorite folder */
export const ImagePickerOverlay = observer((p: { st: TuiSt }) => {
   const s = p.st
   const ip = s.imagePicker
   const iv = ip.selectedVar
   if (iv == null) return null
   const rows = ip.rows
   return (
      <OverlayList
         title={
            <>
               {s.selected?.[1].label ?? s.selected?.[0]} <Text color="gray">{iv.display()}</Text>
            </>
         }
         extraHeader={
            <Box flexDirection="column">
               <Text>
                  {PICKER_PANES.map((pane, ix) => (
                     <Text key={pane}>
                        {ix > 0 ? <Text color="gray"> · </Text> : null}
                        <Text
                           color={pane === ip.pane ? 'cyan' : 'gray'}
                           bold={pane === ip.pane}
                           underline={pane === ip.pane}
                        >
                           {pane}
                        </Text>
                     </Text>
                  ))}
                  {ip.pane === 'browse' ? <Text color="gray"> {ip.folderDisplay}</Text> : null}
               </Text>
               <Text color="yellow">filter: {ip.filter}▌</Text>
            </Box>
         }
         selectedIx={ip.ix}
         lines={s.overlayLines}
         rows={rows.map((row, ix) => {
            const sel = ix === ip.ix
            const fav = row.kind === 'dir' && ip.isFavorite(row.path)
            const missing = row.kind === 'image' && row.missing
            return {
               key: `${row.kind}:${row.path}`,
               node: (
                  <Text
                     key={`${row.kind}:${row.path}`}
                     inverse={sel}
                     color={row.kind === 'dir' ? 'blue' : missing ? 'gray' : undefined}
                     dimColor={missing}
                  >
                     {sel ? '▸ ' : '  '}
                     {fav ? '★ ' : '  '}
                     {row.name}
                     {row.kind === 'dir' ? '/' : ''}
                     {missing ? '  (missing)' : ''}
                  </Text>
               ),
            }
         })}
         footer={
            rows.length === 0 ? (
               <Text color="red">{ip.listingError ?? (ip.filter !== '' ? 'no match' : 'no images here')}</Text>
            ) : undefined
         }
      />
   )
})
