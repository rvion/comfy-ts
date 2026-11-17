// the Claude Code skills ship two ways (the plugin folder, and `comfy-ts skill install` copying
// it) from one folder, and Claude reads their text as truth. This guard keeps them that way: one
// source, and every command, flag, api member and guide section a skill names really exists.
// The samples below show what it catches and what it lets through on purpose.
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'pathe'
import { skillSourceDir } from 'src/cli/skill.ts'

/** a description is in context in every session where the skill is installed: kept well under the docs' 1,536 cap */
const DESCRIPTION_MAX = 300
/** shorter guide lines are headings and fragments any text may share */
const GUIDE_LINE_MIN = 40
const API_OWNERS = ['host', 'wf', 'ComfyTS', 'default', 'v', 'node']

type Ctx = { guide: string; cliCommands: string[]; cliText: string; srcText: string }

function frontmatter(text: string): { data: Record<string, unknown>; body: string } | null {
   const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
   if (m == null) return null
   const data: unknown = Bun.YAML.parse(m[1] ?? '')
   if (typeof data !== 'object' || data == null) return null
   return { data: Object.fromEntries(Object.entries(data)), body: m[2] ?? '' }
}

const declared = (name: string, src: string): boolean =>
   new RegExp(`^\\s*(?:async |static |get |readonly )*${name}\\s*(?:[=(<:,?]|$)`, 'm').test(src)

function skillProblems(text: string, ctx: Ctx): string[] {
   const out: string[] = []
   const fm = frontmatter(text)
   if (fm == null) return ['no parseable frontmatter']
   const description = fm.data.description
   if (typeof description !== 'string' || description.length === 0) out.push('no description')
   else if (description.length > DESCRIPTION_MAX) out.push(`description is ${description.length} chars`)
   if (/\/comfy-ts[-:]/.test(text)) out.push('names its own slash command, which differs per install channel')
   for (const span of text.match(/`[^`\n]+`/g) ?? []) {
      const cmd = /\bcomfy-ts ([a-z]+)/.exec(span)?.[1]
      if (cmd == null) continue
      if (!ctx.cliCommands.includes(cmd)) out.push(`unknown command: comfy-ts ${cmd}`)
      for (const flag of span.match(/--[a-z][a-z-]*/g) ?? []) {
         if (!ctx.cliText.includes(flag)) out.push(`unknown flag: ${flag}`)
      }
   }
   const owners = API_OWNERS.join('|')
   for (const m of text.matchAll(new RegExp(`\\b(?:${owners})\\.([A-Za-z_]\\w*)`, 'g'))) {
      const name = m[1] ?? ''
      if (!declared(name, ctx.srcText)) out.push(`unknown api member: ${m[0]}`)
   }
   for (const m of text.matchAll(/section "([^"]+)"/g)) {
      if (!ctx.guide.includes(`## ${m[1]}\n`)) out.push(`no guide section: ${m[1]}`)
   }
   for (const line of ctx.guide.split('\n')) {
      const t = line.trim()
      if (t.length >= GUIDE_LINE_MIN && text.includes(t)) out.push(`repeats the guide: ${t.slice(0, 50)}`)
   }
   return out
}

function realCtx(): Ctx {
   const cliText = readFileSync('src/cli/comfy-ts-cli.ts', 'utf8')
   const srcFiles = new Bun.Glob('src/**/*.ts').scanSync('.')
   return {
      guide: readFileSync('guide-for-agents.md', 'utf8'),
      cliCommands: [...cliText.matchAll(/cmd === '([a-z]+)'/g)].map((m) => m[1] ?? ''),
      cliText,
      srcText: [...srcFiles].map((f) => readFileSync(f, 'utf8')).join('\n'),
   }
}

const fake: Ctx = {
   guide: '# guide\n\n## Setup flow\n\nA workflow module is a `*.cflow.ts` file (that suffix is what the TUI scans for).\n',
   cliCommands: ['gen', 'run', 'help'],
   cliText: 'comfy-ts gen --id <id> --host <url>\ncomfy-ts run <name> [--out <path>] [--json] --help',
   srcText:
      'class H {\n   importWorkflowJson = (json: unknown) => {}\n   async build(p = {}) {}\n}\nexport const v = {\n   model,\n}',
}
const doc = (body: string, description = 'Write a comfy-ts workflow.'): string =>
   `---\ndescription: ${description}\nargument-hint: "[x] [y]"\n---\n\n${body}\n`

describe('claude skill guard: what it catches', () => {
   it('each offending sample fails with its reason', () => {
      expect(skillProblems('no frontmatter', fake)).toEqual(['no parseable frontmatter'])
      expect(skillProblems(doc('x', 'a'.repeat(301)), fake)).toEqual(['description is 301 chars'])
      expect(skillProblems(doc('Then type /comfy-ts:run.'), fake)).toEqual([
         'names its own slash command, which differs per install channel',
      ])
      expect(skillProblems(doc('Run `bunx comfy-ts generate --id x`.'), fake)).toEqual([
         'unknown command: comfy-ts generate',
      ])
      expect(skillProblems(doc('Run `bunx comfy-ts run x --output a.png`.'), fake)).toEqual(['unknown flag: --output'])
      expect(skillProblems(doc('Call `host.importWorkflowJSON(json)`.'), fake)).toEqual([
         'unknown api member: host.importWorkflowJSON',
      ])
      expect(skillProblems(doc('Read the guide, section "Install".'), fake)).toEqual(['no guide section: Install'])
      expect(
         skillProblems(doc('A workflow module is a `*.cflow.ts` file (that suffix is what the TUI scans for).'), fake),
      ).toEqual(['repeats the guide: A workflow module is a `*.cflow.ts` file (that suf'])
   })

   it('the legitimate lookalikes pass', () => {
      const ok = doc(
         [
            'Run `bunx comfy-ts gen --id <host-id> --host <url>` then `bunx comfy-ts run <module> --<var> <value> --json`.',
            '`comfy-ts run x --help` lists the vars; `--api-key` outside a command span is prose.',
            'Call `host.importWorkflowJson(json)`, then `await m.default.build({ dry: true })`; a `v.model` var.',
            'Read the guide, section "Setup flow". A workflow module is short.',
            'The `comfy-ts` package, a `.comfy-ts/` folder, `/plugin install` and node_modules/comfy-ts/ are fine.',
         ].join('\n'),
      )
      expect(skillProblems(ok, fake)).toEqual([])
   })
})

describe('claude skill: one source, true text', () => {
   const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
   const entry = marketplace.plugins[0]

   it('the marketplace lists one plugin whose folder is the one the CLI copies from', () => {
      expect(marketplace.name).toBe('comfy-ts')
      expect(marketplace.plugins).toHaveLength(1)
      expect(entry.source).toBe('./claude-code')
      const plugin = JSON.parse(readFileSync(join(entry.source, '.claude-plugin/plugin.json'), 'utf8'))
      expect(plugin.name).toBe(entry.name)
      expect(plugin.version).toBeUndefined()
      expect(skillSourceDir()).toBe(resolve(entry.source, 'skills'))
   })

   it('the package ships the plugin folder and the guide the skills point at', () => {
      const files: string[] = JSON.parse(readFileSync('package.json', 'utf8')).files
      expect(files).toContain('claude-code')
      expect(files).toContain('guide-for-agents.md')
   })

   it('every skill passes the guard against the real cli, src and guide', () => {
      const ctx = realCtx()
      expect(ctx.cliCommands).toContain('run')
      const skills = readdirSync(skillSourceDir()).sort()
      expect(skills).toEqual(['convert', 'guide', 'run', 'setup', 'workflow'])
      const problems = skills.flatMap((s) =>
         skillProblems(readFileSync(join(skillSourceDir(), s, 'SKILL.md'), 'utf8'), ctx).map((x) => `${s}: ${x}`),
      )
      expect(problems).toEqual([])
   })
})
