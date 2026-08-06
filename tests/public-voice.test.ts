// every file here is committed to a public repo and read by strangers. A comment, a test name
// or a doc line says WHY a line exists; who asked for it and on what date belongs to git and
// to the private journal. This guard exists because that voice creeps back one comment at a
// time, and it reads as a repo run by an assistant rather than by its author.
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'pathe'

// the repo ROOT files too: README, CHANGELOG and the agent guide are the first prose a
// stranger reads, and they were the one surface this guard did not look at
const ROOTS = ['src', 'tests', 'examples', 'agent', 'scripts', 'extra', '.github', '.comfy-ts/prompt-enhancers']
const ROOT_FILES = ['README.md', 'CHANGELOG.md', 'CLAUDE.md', 'guide-for-agents.md']
const SKIP_DIRS = new Set(['node_modules', 'generated', 'json', 'external-docs'])
// generated sdk faces and upstream data mirrors are DATA, never prose we write
const SKIP_FILES = /\.(json|snap)$|sdk\.d\.ts$/
// this file QUOTES every banned phrase by construction
const SELF = 'tests/public-voice.test.ts'

/** owner narration, agent-process narration, and dates whose only job is to stamp a request */
// `[\w'’-]*\s*` between the possessive and the noun: every real violation had a word in
// between ("his corpus repro", "his small-terminal overflow repro"), which adjacency missed
// the noun list is deliberately UNAMBIGUOUS. "their order" (of loras) and "his model" are
// ordinary English; "his repro" and "her ask" can only be commissioning narration. Dates that
// stamp an instruction are caught separately, which covers "his order 2026-07-31".
const OWNED = String.raw`\b(his|her|their)\s+(?:[\w'’-]+\s+){0,2}(ask|asks|repro|repros|GO|sketch|complaint)\b`

const BANNED: { pattern: RegExp; why: string }[] = [
   { pattern: new RegExp(OWNED, 'i'), why: 'narrates the owner' },
   { pattern: /\b(he|she|they) (asked|wanted|requested|complained|insisted)\b/i, why: 'narrates the owner' },
   { pattern: /\b(rémi|remi vion|rvion) (asked|wants|wanted|said|decided)/i, why: 'names the owner' },
   { pattern: /\bthe (owner|user) (asked|wanted|requested)\b/i, why: 'narrates the owner' },
   { pattern: /\breviewer'?[’']?s? (repro|catch|follow-?up|round)\b/i, why: 'narrates the review process' },
   { pattern: /\bthe (code |security |integration )?review (found|caught|flagged)\b/i, why: 'narrates the review' },
   { pattern: /\bas (requested|asked)\b/i, why: 'narrates the request' },
   { pattern: /\bper (his|her|their|the) feedback\b/i, why: 'narrates the request' },
   { pattern: /\b(co-authored-by|assisted-by|signed-off-by|claude-session)\b/i, why: 'attribution' },
   { pattern: /claude\.(ai|com)/i, why: 'attribution' },
   { pattern: /\bgenerated with\b.*\bclaude\b/i, why: 'attribution' },
   // private data that is ALWAYS a mistake. A deliberate local-tool call is not on this list:
   // naming the machine's own keychain helper is a choice, a pasted credential never is
   { pattern: /\b(ghp_|github_pat_|sk-[A-Za-z0-9]{16}|xox[baprs]-)/, why: 'looks like a credential' },
   // /Users/x/ is the synthetic path the tree tests use; a real one names a person
   { pattern: /\/Users\/(?!x\/)[a-z]+\//i, why: 'a real home directory path' },
]

/** a date whose only job is to stamp an instruction. A date inside a sentence about a MEASURED
 * fact ("probed 2026-07-30 against the live service") is legitimate and stays. */
const DATED_INSTRUCTION = /\b(ask|repro|order|GO|rule|call|decision|complaint)\b[^.\n]{0,40}\b20\d\d-\d\d-\d\d/i

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
      const files = [
         ...ROOTS.flatMap((r) => (existsSync(r) ? walk(r) : [])),
         ...ROOT_FILES.filter((f) => existsSync(f)),
      ]
      for (const file of files) {
         if (file === SELF) continue
         const text = readFileSync(file, 'utf8')
         const lines = text.split('\n')
         lines.forEach((line, ix) => {
            for (const rule of BANNED)
               if (rule.pattern.test(line)) hits.push(`${file}:${ix + 1} (${rule.why}) ${line.trim().slice(0, 90)}`)
         })
         // ALSO across line breaks: a hard-wrapped comment split every phrase in two, which is
         // exactly why the line-by-line pass reported clean while violations sat in the file
         const flat = text.replaceAll(/\s*\n\s*(\/\/|\*|#)?\s*/g, ' ')
         for (const rule of BANNED)
            if (rule.pattern.test(flat) && !lines.some((l) => rule.pattern.test(l)))
               hits.push(`${file} (${rule.why}, wrapped across lines)`)
         if (DATED_INSTRUCTION.test(flat)) hits.push(`${file} (a date stamping an instruction)`)
      }
      expect(hits).toEqual([])
   })
})
