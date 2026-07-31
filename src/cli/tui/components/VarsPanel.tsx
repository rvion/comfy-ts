import { Box, measureElement, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import type { DOMElement } from 'ink'
import { EditField } from 'src/cli/tui/components/EditField.tsx'
import { type AnyVar, PromptVar } from 'src/vars/ComfyVars.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

// long values wrap INSIDE the value column, so wrapped lines never read as a
// new var row (repro: a wrapped prompt showed as 'prompt [textdrawing…').
const VALUE_CAP = 300

/** prompt value cell: magenta injected-keywords chrome line (not part of the
 * text), `//` comments dim gray, `- ` negative lines red */
const PromptCell = observer((p: { varDef: PromptVar; value: string }) => {
   const injected = p.varDef.injectedKeywords()
   return (
      <Box flexDirection="column">
         {injected.length > 0 && (
            <Text color="magenta" wrap="wrap">
               ↳ loras: {injected.join(', ')}
            </Text>
         )}
         {p.value.split('\n').map((line, ix) => {
            const comment = PromptVar.isCommentLine(line)
            const negative = !comment && PromptVar.isNegativeLine(line)
            return (
               <Text key={ix} color={comment ? 'gray' : negative ? 'red' : 'cyan'} dimColor={comment} wrap="wrap">
                  {line === '' ? ' ' : line}
               </Text>
            )
         })}
      </Box>
   )
})

const VarRow = observer(
   (p: { name: string; varDef: AnyVar; selected: boolean; labelW: number; st: TuiSt; compact: boolean }) => {
      // a custom prompt session (draft naming) renders as PromptOverlay, not here
      const editing = p.selected && p.st.mode === 'edit' && !p.st.editor.isCustom
      const label = p.varDef.label ?? p.name
      const raw = p.varDef.display()
      const value = raw.length > VALUE_CAP ? `${raw.slice(0, VALUE_CAP)}…` : raw
      // compact (small terminal, list overflows): NON-selected rows cost ONE
      // line — tall wrapped values above the selection cannot push it off
      const oneLine = p.compact && !p.selected
      return (
         <Box flexDirection="row">
            {/* fixed columns keep wrapped value lines aligned under the value column */}
            <Box width={p.labelW} flexShrink={0}>
               <Text inverse={p.selected}>
                  {p.selected ? '▸ ' : '  '}
                  {label}
               </Text>
            </Box>
            <Box width={9} flexShrink={0}>
               <Text color="gray">[{p.varDef.kind}]</Text>
            </Box>
            <Box flexGrow={1}>
               {editing ? (
                  <EditField st={p.st} />
               ) : oneLine ? (
                  <Text color="cyan" wrap="truncate">
                     {value.replaceAll('\n', ' ')}
                  </Text>
               ) : p.varDef instanceof PromptVar ? (
                  <PromptCell varDef={p.varDef} value={value} />
               ) : (
                  <Text color="cyan" wrap="wrap">
                     {value}
                  </Text>
               )}
            </Box>
         </Box>
      )
   },
)

export const VarsPanel = observer((p: { st: TuiSt }) => {
   const s = p.st
   // label column = longest label + marker, so [kind] and values line up
   const labelW = Math.max(6, ...s.entries.map(([name, v]) => (v.label ?? name).length)) + 3
   const focused = s.mode === 'nav' || s.mode === 'edit'
   const boxRef = useRef<DOMElement>(null)
   useEffect(() => {
      if (boxRef.current != null) s.setVarsViewH(measureElement(boxRef.current).height)
   })
   const w = s.varsWindow
   return (
      <Box
         ref={boxRef}
         borderStyle="round"
         borderColor={focused ? 'cyan' : 'gray'}
         paddingX={1}
         flexDirection="column"
         overflow="hidden"
      >
         {/* marginTop -1 lifts the label onto the border line: the panel key IS its title */}
         <Box marginTop={-1}>
            <Text color={focused ? 'cyan' : 'gray'} bold={focused}>
               (v)ars
            </Text>
         </Box>
         {w.moreAbove && <Text color="gray">…</Text>}
         {s.entries.slice(w.start, w.end).map(([name, varDef], sliceIx) => (
            <VarRow
               key={name}
               name={name}
               varDef={varDef}
               selected={w.start + sliceIx === s.selIx}
               labelW={labelW}
               st={s}
               compact={s.varsCompact}
            />
         ))}
         {w.moreBelow && <Text color="gray">…</Text>}
      </Box>
   )
})
