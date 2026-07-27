import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** right-side panel: selected-lora preview in the loras overlay, live latent while running,
 * last output after — plus the `p` settings menu (mode 'preview') rendered in place.
 * protocol terminals: the body is BLANK cells — useProtocolImage paints the real image over them */
export const PreviewPanel = observer((p: { st: TuiSt }) => {
   const s = p.st
   const pv = s.preview

   if (pv.menuOpen) {
      return (
         <Box borderStyle="double" paddingX={1} flexDirection="column" flexShrink={0} width={pv.width + 4}>
            <Box marginTop={-1}>
               <Text color="gray">(p)review · settings</Text>
            </Box>
            {pv.menuRows.map((row, ix) => {
               const sel = ix === pv.menuIx
               return (
                  <Text key={row.key} inverse={sel} wrap="truncate">
                     {sel ? '▸ ' : '  '}
                     {row.label.padEnd(14)}
                     <Text bold>{row.value}</Text>
                  </Text>
               )
            })}
            <Text> </Text>
            <Text color="gray" wrap="truncate">
               ←→ change · ↑↓ move · ⏎/p/esc done
            </Text>
         </Box>
      )
   }

   const loraMode = s.mode === 'overlay-loras'
   const running = s.exec.running
   const wantLatent = running && pv.duringRun !== 'last-output'
   const showLatent = !loraMode && wantLatent && (pv.latentAnsi != null || pv.latentBytes != null)
   const label = loraMode
      ? `lora ${s.loras.previewName ?? 'lora'}`
      : showLatent
        ? pv.duringRun === 'latent-small'
           ? 'latent small'
           : 'latent'
        : 'output'
   const placeholder = loraMode
      ? (s.loras.previewNote ?? '(pick a lora)')
      : pv.latentsMissing
        ? '(no latents from the server — launch comfy with --preview-method auto)'
        : '(no image yet)'
   const content = pv.useNative
      ? null
      : loraMode
        ? s.loras.previewAnsi
        : showLatent
          ? (pv.latentAnsi ?? pv.outputAnsi)
          : pv.outputAnsi
   const reserveRect = pv.useNative && (pv.protocolImage != null || pv.protocolImageCorner != null)
   return (
      <Box borderStyle="round" paddingX={1} flexDirection="column" flexShrink={0} width={pv.width + 4}>
         {/* marginTop -1 lifts the label onto the border line: the panel key IS its title */}
         <Box marginTop={-1}>
            <Text color="gray" wrap="truncate">
               (p)review · {label} · {pv.renderer}
               {pv.latentsMissing ? <Text color="red"> · no latents!</Text> : null}
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
