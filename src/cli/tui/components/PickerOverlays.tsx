import { Text } from 'ink'
import { observer } from 'src/cli/tui/mobxCompat.ts'
import { OverlayList } from 'src/cli/tui/components/OverlayList.tsx'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** modal option picker: type to fuzzy-filter, ↑/↓ to move, ⏎ to pick */
export const ChoiceOverlay = observer((p: { st: TuiSt }) => {
   const s = p.st
   const pk = s.picker
   const options = pk.options
   return (
      <OverlayList
         title={
            <>
               ⌥ {s.selected ? (s.selected[1].label ?? s.selected[0]) : ''}{' '}
               <Text color="gray">
                  ({options.length} option{options.length === 1 ? '' : 's'})
               </Text>
            </>
         }
         extraHeader={<Text color="yellow">filter: {pk.filter}▌</Text>}
         selectedIx={pk.ix}
         lines={s.overlayLines}
         rows={options.map((opt, ix) => ({
            key: opt,
            node: (
               <Text key={opt} inverse={ix === pk.ix}>
                  {ix === pk.ix ? '▸ ' : '  '}
                  {opt}
               </Text>
            ),
         }))}
         footer={options.length === 0 ? <Text color="red">no match</Text> : undefined}
      />
   )
})

/** modal size picker: presets, or type `WxH` and ⏎ for a custom size */
export const SizeOverlay = observer((p: { st: TuiSt }) => {
   const s = p.st
   const pk = s.picker
   const options = pk.options
   return (
      <OverlayList
         title={
            <>
               size {s.selected ? (s.selected[1].label ?? s.selected[0]) : ''}{' '}
               <Text color="gray">· type WxH for custom</Text>
            </>
         }
         extraHeader={<Text color={pk.invalid ? 'red' : 'yellow'}>filter: {pk.filter}▌</Text>}
         selectedIx={pk.ix}
         lines={s.overlayLines}
         rows={options.map((opt, ix) => ({
            key: opt,
            node: (
               <Text key={opt} inverse={ix === pk.ix}>
                  {ix === pk.ix ? '▸ ' : '  '}
                  {opt}
               </Text>
            ),
         }))}
         footer={options.length === 0 ? <Text color="cyan">⏎ to use custom size “{pk.filter}”</Text> : undefined}
      />
   )
})
