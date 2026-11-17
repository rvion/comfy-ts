import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { installSkills, runSkill, SKILL_RECORD_FILE, type SkillAction, type SkillReport } from 'src/cli/skill.ts'

let root = ''
let from = ''
let to = ''

beforeEach(() => {
   root = mkdtempSync(join(tmpdir(), 'comfy-ts-skill-'))
   from = join(root, 'src-skills')
   to = join(root, 'project', '.claude', 'skills')
   mkdirSync(join(from, 'run'), { recursive: true })
   mkdirSync(join(from, 'convert', 'ref'), { recursive: true })
   writeFileSync(join(from, 'run', 'SKILL.md'), 'run v1\n')
   writeFileSync(join(from, 'convert', 'SKILL.md'), 'convert v1\n')
   writeFileSync(join(from, 'convert', 'ref', 'notes.md'), 'notes v1\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const install = (force = false): SkillReport => installSkills({ from, to, force, version: '9.9.9' })
const actions = (r: SkillReport): Record<string, SkillAction> =>
   Object.fromEntries(r.lines.map((l) => [l.file.slice(to.length + 1), l.action]))
const target = (rel: string): string => readFileSync(join(to, rel), 'utf8')

describe('comfy-ts skill install: copy, rerun, upgrade', () => {
   it('a fresh install copies every file under the comfy-ts- prefix and records what it wrote', () => {
      const r = install()
      expect(r.ok).toBe(true)
      expect(r.commands).toEqual(['/comfy-ts-convert', '/comfy-ts-run'])
      expect(actions(r)).toEqual({
         'comfy-ts-convert/SKILL.md': 'created',
         'comfy-ts-convert/ref/notes.md': 'created',
         'comfy-ts-run/SKILL.md': 'created',
      })
      expect(target('comfy-ts-convert/ref/notes.md')).toBe('notes v1\n')
      const record = JSON.parse(target(SKILL_RECORD_FILE))
      expect(record.version).toBe('9.9.9')
      expect(Object.keys(record.files).sort()).toEqual([
         'comfy-ts-convert/SKILL.md',
         'comfy-ts-convert/ref/notes.md',
         'comfy-ts-run/SKILL.md',
      ])
   })

   it('a second run changes nothing', () => {
      install()
      const r = install()
      expect(r.ok).toBe(true)
      expect(new Set(Object.values(actions(r)))).toEqual(new Set(['unchanged']))
   })

   it('a new package version updates the files the install wrote and nobody touched', () => {
      install()
      writeFileSync(join(from, 'run', 'SKILL.md'), 'run v2\n')
      const r = install()
      expect(r.ok).toBe(true)
      expect(actions(r)['comfy-ts-run/SKILL.md']).toBe('updated')
      expect(target('comfy-ts-run/SKILL.md')).toBe('run v2\n')
   })
})

describe('comfy-ts skill install: an edited file is never overwritten without --force', () => {
   it('an edit is a conflict: nothing is written at all, the edit stays', () => {
      install()
      writeFileSync(join(to, 'comfy-ts-run', 'SKILL.md'), 'run, my edit\n')
      writeFileSync(join(from, 'run', 'SKILL.md'), 'run v2\n')
      writeFileSync(join(from, 'convert', 'SKILL.md'), 'convert v2\n')
      const r = install()
      expect(r.ok).toBe(false)
      expect(actions(r)['comfy-ts-run/SKILL.md']).toBe('conflict')
      expect(target('comfy-ts-run/SKILL.md')).toBe('run, my edit\n')
      // the untouched file would have updated, but a refused install writes nothing
      expect(target('comfy-ts-convert/SKILL.md')).toBe('convert v1\n')
   })

   it('a file already there that the install never wrote is a conflict too', () => {
      mkdirSync(join(to, 'comfy-ts-run'), { recursive: true })
      writeFileSync(join(to, 'comfy-ts-run', 'SKILL.md'), 'a skill of the same name\n')
      const r = install()
      expect(r.ok).toBe(false)
      expect(actions(r)['comfy-ts-run/SKILL.md']).toBe('conflict')
      expect(existsSync(join(to, SKILL_RECORD_FILE))).toBe(false)
   })

   it('--force overwrites the edit and says so', () => {
      install()
      writeFileSync(join(to, 'comfy-ts-run', 'SKILL.md'), 'run, my edit\n')
      const r = install(true)
      expect(r.ok).toBe(true)
      expect(actions(r)['comfy-ts-run/SKILL.md']).toBe('overwritten')
      expect(target('comfy-ts-run/SKILL.md')).toBe('run v1\n')
   })

   it('a skill the package dropped is removed when untouched, kept when edited', () => {
      install()
      writeFileSync(join(to, 'comfy-ts-convert', 'ref', 'notes.md'), 'my notes\n')
      rmSync(join(from, 'convert'), { recursive: true })
      const r = install()
      expect(r.ok).toBe(true)
      expect(actions(r)).toMatchObject({
         'comfy-ts-convert/SKILL.md': 'removed',
         'comfy-ts-convert/ref/notes.md': 'kept',
      })
      expect(existsSync(join(to, 'comfy-ts-convert', 'SKILL.md'))).toBe(false)
      expect(target('comfy-ts-convert/ref/notes.md')).toBe('my notes\n')
      rmSync(join(to, 'comfy-ts-convert'), { recursive: true })
      rmSync(join(from, 'run'), { recursive: true })
      // an untouched skill folder leaves no empty folder behind
      expect(install().ok).toBe(true)
      expect(existsSync(join(to, 'comfy-ts-run'))).toBe(false)
   })

   it('a broken record is a loud error naming the file, never a silent reinstall', () => {
      install()
      writeFileSync(join(to, SKILL_RECORD_FILE), '{ nope')
      expect(() => install()).toThrow(SKILL_RECORD_FILE)
   })
})

describe('comfy-ts skill: the command line', () => {
   const run = (args: string[], env: Record<string, string | undefined> = {}): { code: number; out: string } => {
      const out: string[] = []
      const code = runSkill(args, { cwd: join(root, 'project'), env, log: (l) => out.push(l) })
      return { code, out: out.join('\n') }
   }

   it('installs the shipped skills into .claude/skills of the cwd and prints each file', () => {
      const r = run(['install'])
      expect(r.code).toBe(0)
      expect(existsSync(join(to, 'comfy-ts-guide', 'SKILL.md'))).toBe(true)
      expect(r.out).toContain('+ created     .claude/skills/comfy-ts-run/SKILL.md')
      expect(r.out).toContain('/comfy-ts-convert /comfy-ts-guide /comfy-ts-run /comfy-ts-setup /comfy-ts-workflow')
      expect(run(['install']).out).toContain('= unchanged   .claude/skills/comfy-ts-run/SKILL.md')
   })

   it('a refused install exits 1 and names the edited file', () => {
      run(['install'])
      writeFileSync(join(to, 'comfy-ts-run', 'SKILL.md'), 'mine\n')
      const r = run(['install'])
      expect(r.code).toBe(1)
      expect(r.out).toContain('✗ conflict    .claude/skills/comfy-ts-run/SKILL.md')
      expect(r.out).toContain('--force')
      expect(run(['install', '--force']).code).toBe(0)
   })

   it('--user writes into the Claude config dir: CLAUDE_CONFIG_DIR first, then ~/.claude', () => {
      expect(run(['install', '--user'], { CLAUDE_CONFIG_DIR: join(root, 'cfg') }).code).toBe(0)
      expect(existsSync(join(root, 'cfg', 'skills', 'comfy-ts-setup', 'SKILL.md'))).toBe(true)
      expect(run(['install', '--user'], { HOME: join(root, 'home') }).code).toBe(0)
      expect(existsSync(join(root, 'home', '.claude', 'skills', 'comfy-ts-setup', 'SKILL.md'))).toBe(true)
   })

   it('--dir writes into that folder, relative to the cwd', () => {
      expect(run(['install', '--dir', 'agents/skills']).code).toBe(0)
      expect(existsSync(join(root, 'project', 'agents', 'skills', 'comfy-ts-workflow', 'SKILL.md'))).toBe(true)
   })

   it('a typo or two targets is an error, never a guess', () => {
      expect(() => run(['instal'])).toThrow('unknown skill command')
      expect(() => run(['install', '--usr'])).toThrow('unknown argument "--usr"')
      expect(() => run(['install', '--dir'])).toThrow('--dir needs a value')
      expect(() => run(['install', '--user', '--dir', 'x'])).toThrow('pass one')
      expect(run([]).code).toBe(0)
   })
})
