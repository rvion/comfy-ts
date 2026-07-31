import { Text } from 'ink'
import { observer } from 'mobx-react-lite'
import { OverlayList } from 'src/cli/tui/components/OverlayList.tsx'
import { getLoraDisplayName } from 'src/host/loraInfoCache.ts'
import { loraBasename } from 'src/host/loraManagerApi.ts'
import { getLoraKeyword, isLoraKeywordFromMirror } from 'src/vars/loraKeywords.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** modal multi-select: tick/untick loras, filter, bulk ops, step strengths */
export const LorasOverlay = observer((p: { st: TuiSt }) => {
   const s = p.st
   const lo = s.loras
   const lv = lo.selectedVar
   if (lv == null) return null
   const names = lo.filteredNames
   return (
      <OverlayList
         title={
            <>
               {s.selected?.[1].label ?? s.selected?.[0]} <Text color="gray">{lv.display()}</Text>
            </>
         }
         extraHeader={<Text color="yellow">filter: {lo.filter}▌</Text>}
         selectedIx={lo.ix}
         lines={s.overlayLines}
         rows={names.map((name, ix) => {
            const on = lv.isOn(name)
            const keyword = getLoraKeyword(name, lo.hostId)
            // a keyword NOBODY typed reads as magic unless it looks different from
            // one you set yourself: mirror-sourced is dim, hand-typed is not
            const fromMirror = isLoraKeywordFromMirror(name, lo.hostId)
            const file = loraBasename(name)
            // the human name from the lora-manager mirror, shown only when it adds something
            const display = getLoraDisplayName(name, lo.hostId)
            return {
               key: name,
               node: (
                  // checked = whole row green with a bold checkmark (emoji checkboxes read identical at cell size)
                  <Text key={name} inverse={ix === lo.ix} bold={on} color={on ? 'green' : 'gray'}>
                     {ix === lo.ix ? '▸ ' : '  '}
                     {on ? '✔' : '·'} {file}
                     {on ? `  ${lv.strengthLabel(name)}` : ''}
                     {display !== file && (
                        <Text color="cyan" dimColor bold={false}>
                           {'  '}
                           {display}
                        </Text>
                     )}
                     {keyword !== '' && (
                        <Text color={fromMirror ? 'gray' : 'yellow'} dimColor={fromMirror} bold={false}>
                           {'  kw: '}
                           {keyword}
                        </Text>
                     )}
                  </Text>
               ),
            }
         })}
         footer={names.length === 0 ? <Text color="red">no match</Text> : undefined}
      />
   )
})
