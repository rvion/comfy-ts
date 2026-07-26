import { Box, Text } from 'ink'
import { observer } from 'mobx-react-lite'
import type { ReactNode } from 'react'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

export type Hint = [key: string, label: string]

/** keys cyan, labels gray — shared by the keybar and overlay footers */
export const KeyHints = (p: { hints: Hint[] }): ReactNode => (
   <Text wrap="wrap">
      {p.hints.map(([k, label], ix) => (
         <Text key={`${k}·${label}`}>
            {ix > 0 ? <Text color="gray"> · </Text> : null}
            <Text color="cyan">{k}</Text>
            <Text color="gray"> {label}</Text>
         </Text>
      ))}
   </Text>
)

export const ProgressLine = observer((p: { st: TuiSt }) => {
   const s = p.st
   const e = s.exec
   const queued = s.queue.remaining
   if (s.mode === 'edit' || s.mode === 'overlay-text') return <Text color="gray">editing…</Text>
   if (e.running) {
      const prog = e.progress
      const width = 16
      const filled = prog ? Math.round((prog.percent / 100) * width) : 0
      const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
      return (
         <Text>
            {'>> '}[{bar}] {prog ? `${prog.percent.toFixed(0)}%` : '…'}
            {prog?.nodeName ? ` · ${prog.nodeName}` : ''}
            {prog ? ` · ${(prog.elapsedMs / 1000).toFixed(0)}s` : ''}
            {queued > 0 ? ` · queue ${queued}` : ''}
         </Text>
      )
   }
   if (e.error) return <Text color="red">{e.error}</Text>
   if (e.notice) return <Text>{e.notice}</Text>
   if (queued > 0) return <Text color="yellow">{queued} queued on the server</Text>
   if (e.runCount > 0)
      return (
         <Text color={e.lastStatus === 'Success' ? 'green' : 'red'}>
            run #{e.runCount} {e.lastStatus?.toLowerCase()}
         </Text>
      )
   return <Text color="gray">ready — r to run</Text>
})

const KIND_KEYS: Record<string, Hint[]> = {
   text: [['⏎/→', 'edit']],
   int: [['⏎/→', 'edit']],
   float: [['⏎/→', 'edit']],
   seed: [
      ['+', 'increment'],
      ['-', 'decrement'],
      ['?', 'random'],
      ['=', 'fixed'],
      ['⏎/→', 'type value'],
      ['*', 'reroll'],
   ],
   toggle: [['⏎/→', 'flip']],
   choice: [['⏎/→', 'pick']],
   size: [['⏎/→', 'pick']],
   loras: [['⏎/→', 'select']],
}

/** shown INSIDE the text editor box (TextOverlay footer), not in the keybar */
export const TEXT_EDIT_HINTS: Hint[] = [
   ['⏎', 'save'],
   ['⇧⏎/⌥⏎', 'newline'],
   ['esc', 'cancel'],
   ['⌥⌫', 'del word'],
   ['⌥←→', 'jump'],
   ['⌘←→/⌃A⌃E', 'line ends'],
   ['⌥↑↓', 'move line'],
   ['⌘/', 'comment'],
   ['⌃U/⌃K', 'kill'],
]

export const DRAFT_OP_HINTS: Hint[] = [
   ['n', 'new'],
   ['e', 'rename'],
   ['c', 'duplicate'],
   ['x', 'delete'],
]

const MODE_KEYS: Partial<Record<string, Hint[]>> = {
   edit: [
      ['⏎', 'apply'],
      ['esc', 'cancel'],
      ['⌥⌫/⌃W', 'del word'],
      ['⌥←→', 'jump'],
      ['⌃A/⌃E', 'line ends'],
      ['⌃U/⌃K', 'kill'],
   ],
   'overlay-text': TEXT_EDIT_HINTS,
   'overlay-choice': [
      ['⏎', 'pick'],
      ['↑↓', 'move'],
      ['type', 'filter'],
      ['esc', 'cancel'],
   ],
   'overlay-size': [
      ['⏎', 'pick'],
      ['↑↓', 'move'],
      ['type', 'filter or WxH'],
      ['esc', 'cancel'],
   ],
   'overlay-loras': [
      ['space/⏎', 'tick'],
      ['←→', 'strength ±0.05'],
      ['type', 'filter'],
      ['⌃K', 'keyword'],
      ['⌃A', 'all'],
      ['⌃N', 'none'],
      ['esc', 'done'],
   ],
   'overlay-drafts': [['⏎', 'load / new'], ...DRAFT_OP_HINTS, ['↑↓', 'move'], ['esc', 'cancel']],
   tree: [['⏎', 'load'], ['↑↓', 'move'], ['←', 'fold'], ['→', 'unfold / vars'], ...DRAFT_OP_HINTS, ['t/esc', 'back']],
   host: [
      ['⏎', 'run action'],
      ['↑↓', 'move'],
      ['h/esc', 'back'],
   ],
}

/** persistent 2-line keybar: EVERYTHING available right now, always visible */
export const KeyBar = observer((p: { st: TuiSt }) => {
   const s = p.st
   const kind = s.selected?.[1].kind
   const modeHints: Hint[] = MODE_KEYS[s.mode] ?? [
      ['↑↓', 'select'],
      ['←', 'tree'],
      ...(kind ? (KIND_KEYS[kind] ?? []) : []),
   ]
   // keys already advertised by a panel title (t/v/p) or a header box (w/d/h)
   // are NOT repeated here — one letter, one place
   const globalHints: Hint[] =
      s.mode === 'nav' || s.mode === 'tree' || s.mode === 'host'
         ? [
              ['r', 'run'],
              ['s', 'reroll+run'],
              ...(s.mode === 'nav' ? ([['e', 'rename draft']] as Hint[]) : []),
              // the preview panel carries `p` in its title — unless it is hidden
              ...(s.preview.show ? [] : ([['p', 'preview off']] as Hint[])),
              ['o', 'open image'],
              // c is duplicate inside the tree — don't advertise the copy pair there
              ...(s.mode === 'tree' ? [] : ([['c/C', 'copy wf/api']] as Hint[])),
              ['q', 'quit'],
           ]
         : [
              ['⌃R', 'run'],
              ['esc', 'back'],
           ]
   return (
      <Box flexDirection="column" paddingX={1}>
         {/* the text editor shows its keys under its own box */}
         {s.mode !== 'overlay-text' && <KeyHints hints={modeHints} />}
         <KeyHints hints={globalHints} />
      </Box>
   )
})
