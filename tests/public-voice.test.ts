// Every file here is committed to a public repo and read by strangers. A comment, a test name
// or a doc line says WHY a line exists; who asked for it and on what date belongs to git and
// to the private journal. This guard exists because that voice creeps back one comment at a
// time, and it reads as a repo run by an assistant rather than by its author.
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'pathe'

const ROOTS = ['src', 'tests', 'examples', 'agent', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'generated', 'json', 'external-docs'])
// generated sdk faces and upstream data mirrors are DATA, never prose we write
const SKIP_FILES = /\.(json|snap)$|sdk\.d\.ts$/

/** owner narration, agent-process narration, and dates whose only job is to stamp a request */
const BANNED: { pattern: RegExp; why: string }[] = [
   { pattern: /\bhis (ask|repro|order|GO|call|rule|model|standing|sketch)\b/i, why: 'narrates the owner' },
   { pattern: /\b(he|she|they) (asked|wanted|requested) (for|it|us|me)\b/i, why: 'narrates the owner' },
   { pattern: /\breviewer'?s? (repro|catch|follow-?up|round)\b/i, why: 'narrates the review process' },
   { pattern: /\bas (requested|asked)\b/i, why: 'narrates the request' },
   { pattern: /\bper (his|the) feedback\b/i, why: 'narrates the request' },
   { pattern: /\bco-authored-by\b/i, why: 'attribution' },
   { pattern: /claude\.(ai|com)/i, why: 'attribution' },
   { pattern: /\bgenerated with\b.*\bclaude\b/i, why: 'attribution' },
]

function walk(dir: string, out: string[] = []): string[] {
   for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path, out)
      else if (!SKIP_FILES.test(path)) out.push(path)
   }
   return out
}

describe('public surfaces carry no commissioning voice', () => {
   it('no owner or review narration in committed source, tests, examples or docs', () => {
      const hits: string[] = []
      for (const root of ROOTS)
         for (const file of walk(root)) {
            const lines = readFileSync(file, 'utf8').split('\n')
            lines.forEach((line, ix) => {
               for (const rule of BANNED)
                  if (rule.pattern.test(line)) hits.push(`${file}:${ix + 1} (${rule.why}) ${line.trim().slice(0, 90)}`)
            })
         }
      expect(hits).toEqual([])
   })
})
