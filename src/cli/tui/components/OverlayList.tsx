import { Box, Text } from 'ink'
import type { ReactNode } from 'react'

/** generic modal list: title + rows windowed around the selected index */
export const OverlayList = (p: {
   title: ReactNode
   rows: { key: string; node: ReactNode }[]
   selectedIx: number
   lines: number
   extraHeader?: ReactNode
   footer?: ReactNode
}): ReactNode => {
   const winStart = Math.max(0, Math.min(p.selectedIx - Math.floor(p.lines / 2), p.rows.length - p.lines))
   const visible = p.rows.slice(winStart, winStart + p.lines)
   return (
      <Box borderStyle="double" paddingX={1} flexDirection="column">
         <Text bold>{p.title}</Text>
         {p.extraHeader}
         {winStart > 0 && <Text color="gray">…</Text>}
         {visible.map((r) => r.node)}
         {winStart + p.lines < p.rows.length && <Text color="gray">…</Text>}
         {p.footer}
      </Box>
   )
}
