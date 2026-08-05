import { Text } from 'ink'
import { observer } from 'src/cli/tui/mobxCompat.ts'
import { OverlayList } from 'src/cli/tui/components/OverlayList.tsx'
import { DRAFT_OP_HINTS, KeyHints } from 'src/cli/tui/components/StatusBar.tsx'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** modal draft picker: row 0 creates a new draft, the rest load existing ones */
export const DraftsOverlay = observer((p: { st: TuiSt }) => {
   const s = p.st
   const d = s.drafts
   const rows = [
      {
         key: '·new·',
         node: (
            <Text key="·new·" inverse={d.ix === 0}>
               {d.ix === 0 ? '▸ ' : '  '}new draft
            </Text>
         ),
      },
      ...d.list.map((name, ix) => ({
         key: name,
         node: (
            <Text key={name} inverse={ix + 1 === d.ix}>
               {ix + 1 === d.ix ? '▸ ' : '  '}
               {name === d.active ? '● ' : '  '}
               {name}
            </Text>
         ),
      })),
   ]
   return (
      <OverlayList
         title={
            <>
               drafts <Text color="gray">· {s.wf.spec.id ?? 'workflow'}</Text>
            </>
         }
         selectedIx={d.ix}
         lines={s.overlayLines}
         rows={rows}
         footer={<KeyHints hints={DRAFT_OP_HINTS} />}
      />
   )
})
