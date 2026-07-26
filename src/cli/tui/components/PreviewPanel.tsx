import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** right-side panel: selected-lora preview in the loras overlay, live latent while running, last output after.
 * protocol terminals: the body is BLANK cells — useProtocolImage paints the real image over them */
export const PreviewPanel = observer((p: { st: TuiSt }) => {
   const s = p.st
   const pv = s.preview
   const loraMode = s.mode === 'overlay-loras'
   const showLatent = !loraMode && s.exec.running && (pv.latentAnsi != null || pv.latentBytes != null)
   const label = loraMode ? `lora ${s.loras.previewName ?? 'lora'}` : showLatent ? 'latent' : 'output'
   const placeholder = loraMode ? (s.loras.previewNote ?? '(pick a lora)') : '(no image yet)'
   const content = pv.useNative ? null : loraMode ? s.loras.previewAnsi : showLatent ? pv.latentAnsi : pv.outputAnsi
   const reserveRect = pv.useNative && pv.protocolImage != null
   return (
      <Box borderStyle="round" paddingX={1} flexDirection="column" flexShrink={0} width={pv.width + 4}>
         {/* marginTop -1 lifts the label onto the border line: the panel key IS its title */}
         <Box marginTop={-1}>
            <Text color="gray" wrap="truncate">
               (p)review · {label}
            </Text>
         </Box>
         {reserveRect ? (
            Array.from({ length: pv.height }, (_, ix) => <Text key={ix}> </Text>)
         ) : content != null ? (
            <Text>{content}</Text>
         ) : (
            <Text color="gray">{placeholder}</Text>
         )}
      </Box>
   )
})
