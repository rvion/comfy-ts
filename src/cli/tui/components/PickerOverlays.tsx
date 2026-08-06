import { Text } from 'ink'
import { observer } from 'mobx-react-lite'
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

/** modal preset picker (`P` on a text/prompt var): the label, then a dim peek at the text it
 * writes — two presets whose names are close are told apart by their first line, not by memory */
export const PresetOverlay = observer((p: { st: TuiSt }) => {
   const s = p.st
   const pk = s.picker
   const options = pk.presetOptions
   const current = pk.presetVar?.value.trim() ?? ''
   return (
      <OverlayList
         title={
            <>
               presets {s.selected ? (s.selected[1].label ?? s.selected[0]) : ''}{' '}
               <Text color="gray">· ⏎ replaces the text</Text>
            </>
         }
         extraHeader={<Text color="yellow">filter: {pk.filter}▌</Text>}
         selectedIx={pk.ix}
         lines={s.overlayLines}
         rows={options.map((opt, ix) => ({
            key: opt.label,
            node: (
               <Text key={opt.label} inverse={ix === pk.ix} wrap="truncate">
                  {ix === pk.ix ? '▸ ' : '  '}
                  {opt.text.trim() === current ? '• ' : '  '}
                  {opt.label} <Text color="gray">{firstLine(opt.text)}</Text>
               </Text>
            ),
         }))}
         footer={options.length === 0 ? <Text color="red">no match</Text> : undefined}
      />
   )
})

function firstLine(text: string): string {
   return text.split('\n').find((l) => l.trim() !== '') ?? ''
}

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
