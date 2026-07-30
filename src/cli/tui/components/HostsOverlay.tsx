import { Text } from 'ink'
import { observer } from 'mobx-react-lite'
import { OverlayList } from 'src/cli/tui/components/OverlayList.tsx'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** modal host picker (`h`): row 0 restores the workflow's own host, the rest
 * override where runs are built and sent (every registered host is listed) */
export const HostsOverlay = observer((p: { st: TuiSt }) => {
   const s = p.st
   const h = s.host
   const rows = h.pickerRows.map((row, ix) => ({
      key: row.host?.data.id ?? '·default·',
      node: (
         <Text key={row.host?.data.id ?? '·default·'} inverse={ix === h.pickerIx}>
            {ix === h.pickerIx ? '▸ ' : '  '}
            {row.active ? '● ' : '  '}
            {row.label}
         </Text>
      ),
   }))
   return (
      <OverlayList
         title={
            <>
               run host <Text color="gray">· overrides the workflow's configured host</Text>
            </>
         }
         selectedIx={h.pickerIx}
         lines={s.overlayLines}
         rows={rows}
      />
   )
})
