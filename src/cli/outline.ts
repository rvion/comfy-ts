// outline a generated sdk.d.ts without reading 2MB blind
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'pathe'

type Section = { name: string; kind: string; start: number; end: number; depth: number }

function findDefaultSdk(): string | null {
   const hostsDir = join(process.cwd(), '.comfy-ts', 'hosts')
   if (!existsSync(hostsDir)) return null
   for (const id of readdirSync(hostsDir)) {
      const p = join(hostsDir, id, 'sdk.d.ts')
      if (existsSync(p)) return p
   }
   return null
}

export function runOutline(args: string[]): number {
   const linesFlagIx = args.indexOf('--lines')
   const maxLines = linesFlagIx >= 0 ? Number(args[linesFlagIx + 1] ?? 10) : null
   const sectionFlagIx = args.indexOf('--section')
   const wantedSection = sectionFlagIx >= 0 ? args[sectionFlagIx + 1] : null
   const flagValueIxs = new Set([linesFlagIx + 1, sectionFlagIx + 1].filter((ix) => ix > 0))
   const fileArg = args.find((a, ix) => !a.startsWith('--') && !flagValueIxs.has(ix))

   const file = fileArg ?? findDefaultSdk()
   if (file == null || !existsSync(file)) {
      console.error('[sdk-outline] 🔴 no sdk.d.ts found; pass a path explicitly')
      return 1
   }

   const lines = readFileSync(file, 'utf8').split('\n')

   // scan: track brace depth, record interface/type/namespace declarations up to depth 3
   const sections: Section[] = []
   const stack: Section[] = []
   let depth = 0
   const declRe = /^\s*(?:export\s+)?(interface|namespace|type)\s+([A-Za-z0-9_$]+)/
   for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const m = depth <= 3 ? declRe.exec(line) : null
      const opens = (line.match(/{/g) ?? []).length
      const closes = (line.match(/}/g) ?? []).length
      if (m && (opens > 0 || m[1] === 'type')) {
         const sec: Section = { name: m[2] ?? '?', kind: m[1] ?? '?', start: i + 1, end: i + 1, depth }
         sections.push(sec)
         if (opens > closes) stack.push(sec)
      }
      depth += opens - closes
      while (stack.length > 0 && depth <= (stack[stack.length - 1]?.depth ?? 0)) {
         const closed = stack.pop()
         if (closed) closed.end = i + 1
      }
      // type aliases (no braces): extend until next decl at same depth
      const last = sections[sections.length - 1]
      if (last && last.kind === 'type' && stack[stack.length - 1] !== last) last.end = Math.max(last.end, i)
   }

   if (wantedSection) {
      const sec = sections.find((s) => s.name === wantedSection)
      if (sec == null) {
         console.error(
            `[sdk-outline] 🔴 section "${wantedSection}" not found. Available: ${sections.map((s) => s.name).join(', ')}`,
         )
         return 1
      }
      const body = lines.slice(sec.start - 1, maxLines ? Math.min(sec.end, sec.start - 1 + maxLines) : sec.end)
      console.log(body.join('\n'))
      if (maxLines && sec.end - sec.start + 1 > maxLines)
         console.log(`… (${sec.end - sec.start + 1 - maxLines} more lines, ends at line ${sec.end})`)
   } else {
      console.log(`${file} — ${lines.length} lines\n`)
      for (const s of sections) {
         const indent = '  '.repeat(s.depth)
         console.log(`${indent}${s.kind} ${s.name}  [${s.start}-${s.end}] (${s.end - s.start + 1} lines)`)
         if (maxLines) {
            const body = lines.slice(s.start - 1, s.start - 1 + maxLines)
            console.log(body.map((l) => `${indent}   │ ${l.trim()}`).join('\n'))
         }
      }
   }
   return 0
}
