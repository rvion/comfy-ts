import { Box, Text } from 'ink'
import { observer } from 'src/cli/tui/mobxCompat.ts'
import { KeyHints, TEXT_EDIT_HINTS } from 'src/cli/tui/components/StatusBar.tsx'
import { PromptVar } from 'src/vars/ComfyVars.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** modal multiline editor: real newlines, caret rendered per code point.
 * The cursor's LOGICAL line is background-highlighted (word wrap hides line
 * bounds — the highlight shows exactly what ⌥↑↓ will move); on prompt vars,
 * `//` comment lines render dim gray, `- ` negative lines red, and the
 * injected lora keywords show as a magenta chrome line (not editable). */
export const TextOverlay = observer((p: { st: TuiSt }) => {
   const s = p.st
   const ed = s.editor
   const winLines = s.overlayLines
   const selectedVar = s.selected?.[1]
   // kind, never instanceof: the cli bundle and a consumer's `comfy-ts` import hold
   // different copies of every var class (VarKind owns the WHY). Cast is the sanctioned
   // kind-narrowing family (agent/coding.md whitelist 6)
   const promptVar = selectedVar?.kind === 'prompt' ? (selectedVar as PromptVar) : null
   const isPrompt = promptVar != null
   const injected = promptVar?.injectedKeywords() ?? []
   // lines with their global code-point start offsets
   const lines: { text: string; start: number }[] = []
   let start = 0
   for (const text of ed.buffer.split('\n')) {
      lines.push({ text, start })
      start += [...text].length + 1
   }
   let cursorLine = 0
   for (let i = 0; i < lines.length; i++) if ((lines[i]?.start ?? 0) <= ed.cursor) cursorLine = i
   const winStart = Math.max(0, Math.min(cursorLine - Math.floor(winLines / 2), lines.length - winLines))
   const visible = lines.slice(winStart, winStart + winLines)
   const color = ed.invalid ? 'red' : 'yellow'
   return (
      <Box borderStyle="double" paddingX={1} flexDirection="column">
         <Text bold>{s.selected ? (s.selected[1].label ?? s.selected[0]) : ''}</Text>
         {/* injected lora keywords: CHROME above the buffer — the cursor can never enter it */}
         {injected.length > 0 && (
            <Text color="magenta" wrap="wrap">
               ↳ loras: {injected.join(', ')} <Text dimColor>(injected)</Text>
            </Text>
         )}
         {winStart > 0 && <Text color="gray">… {winStart} more line(s)</Text>}
         {visible.map((line, ix) => {
            const globalIx = winStart + ix
            const comment = isPrompt && PromptVar.isCommentLine(line.text)
            const negative = isPrompt && !comment && PromptVar.isNegativeLine(line.text)
            const lineColor = comment ? 'gray' : negative ? 'red' : color
            if (globalIx !== cursorLine)
               return (
                  <Text key={globalIx} color={lineColor} dimColor={comment}>
                     {line.text === '' ? ' ' : line.text}
                  </Text>
               )
            const cs = [...line.text]
            const col = ed.cursor - line.start
            const before = cs.slice(0, col).join('')
            const at = cs[col] ?? ' '
            const after = cs.slice(col + 1).join('')
            return (
               <Text key={globalIx} color={lineColor} dimColor={comment} backgroundColor="blackBright">
                  {before}
                  <Text inverse>{at}</Text>
                  {after}
               </Text>
            )
         })}
         {winStart + winLines < lines.length && (
            <Text color="gray">… {lines.length - winStart - winLines} more line(s)</Text>
         )}
         {/* edit keys sit right under the text, not at the screen bottom */}
         <KeyHints hints={TEXT_EDIT_HINTS} />
      </Box>
   )
})
