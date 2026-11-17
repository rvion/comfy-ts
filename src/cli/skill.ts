// `comfy-ts skill install`: copy the Claude Code skills of claude-code/skills/ into a skills folder.
// the record file holds the hash of every file the install wrote: it is what tells an untouched
// file (safe to update) from one the user edited (never overwritten without --force)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'pathe'
import { comfyTsPackageDir } from 'src/exampleAssets.ts'

export const SKILL_PREFIX = 'comfy-ts-'
export const SKILL_RECORD_FILE = '.comfy-ts-skills.json'

export const SKILL_USAGE = `comfy-ts skill install [--user | --dir <skills-dir>] [--force]
   copy the comfy-ts Claude Code skills into .claude/skills/ of the cwd (--user: your personal
   skills folder, --dir: that folder): /comfy-ts-guide, /comfy-ts-setup, /comfy-ts-workflow,
   /comfy-ts-convert, /comfy-ts-run. A rerun updates what it wrote; a file you edited is never
   overwritten without --force. The same skills ship as a Claude Code plugin:
   /plugin marketplace add rvion/comfy-ts, then /plugin install comfy-ts@comfy-ts`

export type SkillAction = 'created' | 'unchanged' | 'updated' | 'overwritten' | 'removed' | 'kept' | 'conflict'
export type SkillLine = { action: SkillAction; file: string }
export type SkillReport = { ok: boolean; lines: SkillLine[]; commands: string[] }
type SkillRecord = { version: string; files: Record<string, string> }

/** claude-code/skills/ of the installed package, resolved from this module, never from the cwd */
export function skillSourceDir(): string {
   const pkgDir = comfyTsPackageDir(import.meta.url)
   if (pkgDir == null) throw new Error('cannot find the comfy-ts package this command runs from')
   const dir = join(pkgDir, 'claude-code', 'skills')
   if (!existsSync(dir)) throw new Error(`the comfy-ts package has no skills folder at ${dir}`)
   return dir
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** every file under a skill folder, as paths relative to it */
function filesUnder(dir: string, prefix = ''): string[] {
   const out: string[] = []
   for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) out.push(...filesUnder(abs, `${prefix}${name}/`))
      else out.push(`${prefix}${name}`)
   }
   return out
}

function readRecord(path: string): SkillRecord | null {
   if (!existsSync(path)) return null
   let parsed: unknown
   try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
   } catch (e) {
      throw new Error(`${path} is not valid json (${e instanceof Error ? e.message : String(e)}): fix or delete it`, {
         cause: e,
      })
   }
   if (typeof parsed !== 'object' || parsed == null || !('files' in parsed)) {
      throw new Error(`${path} has no "files" map: fix or delete it`)
   }
   const files = parsed.files
   if (typeof files !== 'object' || files == null) throw new Error(`${path} has no "files" map: fix or delete it`)
   const out: Record<string, string> = {}
   for (const [k, v] of Object.entries(files)) if (typeof v === 'string') out[k] = v
   const version = 'version' in parsed && typeof parsed.version === 'string' ? parsed.version : ''
   return { version, files: out }
}

function packageVersion(pkgDir: string): string {
   const parsed: unknown = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
   if (typeof parsed === 'object' && parsed != null && 'version' in parsed && typeof parsed.version === 'string') {
      return parsed.version
   }
   throw new Error(`${join(pkgDir, 'package.json')} has no version`)
}

/**
 * plan, then write only when nothing conflicts (or `force`): a conflict anywhere writes nothing,
 * so a refused install never leaves half an update behind
 */
export function installSkills(p: { from: string; to: string; force: boolean; version: string }): SkillReport {
   const recordPath = join(p.to, SKILL_RECORD_FILE)
   const record = readRecord(recordPath)
   const source = new Map<string, Buffer>()
   const commands: string[] = []
   for (const skill of readdirSync(p.from).sort()) {
      if (!statSync(join(p.from, skill)).isDirectory()) continue
      commands.push(`/${SKILL_PREFIX}${skill}`)
      for (const f of filesUnder(join(p.from, skill))) {
         source.set(`${SKILL_PREFIX}${skill}/${f}`, readFileSync(join(p.from, skill, f)))
      }
   }

   const lines: SkillLine[] = []
   const writes: string[] = []
   const removals: string[] = []
   for (const [rel, bytes] of source) {
      const abs = join(p.to, rel)
      if (!existsSync(abs)) {
         lines.push({ action: 'created', file: abs })
         writes.push(rel)
         continue
      }
      const onDisk = readFileSync(abs)
      if (onDisk.equals(bytes)) lines.push({ action: 'unchanged', file: abs })
      else if (record?.files[rel] === sha256(onDisk)) {
         lines.push({ action: 'updated', file: abs })
         writes.push(rel)
      } else if (p.force) {
         lines.push({ action: 'overwritten', file: abs })
         writes.push(rel)
      } else lines.push({ action: 'conflict', file: abs })
   }
   for (const [rel, hash] of Object.entries(record?.files ?? {})) {
      const abs = join(p.to, rel)
      if (source.has(rel) || !existsSync(abs)) continue
      if (sha256(readFileSync(abs)) === hash) {
         lines.push({ action: 'removed', file: abs })
         removals.push(rel)
      } else lines.push({ action: 'kept', file: abs })
   }

   if (lines.some((l) => l.action === 'conflict')) return { ok: false, lines, commands }

   for (const rel of writes) {
      const abs = join(p.to, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, source.get(rel) ?? Buffer.alloc(0))
   }
   for (const rel of removals) {
      const abs = join(p.to, rel)
      rmSync(abs)
      // the skill folder goes too once it is empty, so no dead slash command stays listed
      const dir = dirname(abs)
      if (readdirSync(dir).length === 0) rmdirSync(dir)
   }
   const files: Record<string, string> = {}
   for (const [rel, bytes] of source) files[rel] = sha256(bytes)
   mkdirSync(p.to, { recursive: true })
   writeFileSync(recordPath, `${JSON.stringify({ version: p.version, files }, null, 3)}\n`)
   return { ok: true, lines, commands }
}

const MARK: Record<SkillAction, string> = {
   created: '+',
   unchanged: '=',
   updated: '~',
   overwritten: '!',
   removed: '-',
   kept: '?',
   conflict: '✗',
}

export function runSkill(
   args: string[],
   p: { cwd?: string; env?: Record<string, string | undefined>; log?: (line: string) => void } = {},
): number {
   const log = p.log ?? console.log
   const cwd = p.cwd ?? process.cwd()
   const env = p.env ?? process.env
   const sub = args[0]
   const rest = args.slice(1)
   if (sub == null || sub === 'help' || sub === '--help' || rest.includes('--help')) {
      log(SKILL_USAGE)
      return 0
   }
   if (sub !== 'install') throw new Error(`unknown skill command "${sub}"\n${SKILL_USAGE}`)

   let user = false
   let force = false
   let dir: string | null = null
   for (let i = 0; i < rest.length; i++) {
      const a = rest[i]
      if (a === '--user') user = true
      else if (a === '--force') force = true
      else if (a === '--dir') {
         const v = rest[++i]
         if (v == null || v.startsWith('--')) throw new Error('--dir needs a value')
         dir = v
      } else throw new Error(`unknown argument "${a}"\n${SKILL_USAGE}`)
   }
   if (user && dir != null) throw new Error('--user and --dir name two targets: pass one')

   const configDir = env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), '.claude')
   const to = dir != null ? resolve(cwd, dir) : user ? join(configDir, 'skills') : join(cwd, '.claude', 'skills')
   const from = skillSourceDir()
   const version = packageVersion(dirname(dirname(from)))
   const show = (abs: string): string => {
      const rel = relative(cwd, abs)
      return rel.startsWith('..') ? abs : rel
   }

   const report = installSkills({ from, to, force, version })
   log(`[comfy-ts skill] comfy-ts ${version} skills → ${show(to)}`)
   for (const l of report.lines) log(`   ${MARK[l.action]} ${l.action.padEnd(11)} ${show(l.file)}`)
   if (!report.ok) {
      const n = report.lines.filter((l) => l.action === 'conflict').length
      log(
         `[comfy-ts skill] 🔴 ${n} file(s) changed since comfy-ts wrote them (✗ above): nothing was written. Keep your edits, or rerun with --force to overwrite them`,
      )
      return 1
   }
   const kept = report.lines.filter((l) => l.action === 'kept').length
   if (kept > 0) log(`[comfy-ts skill] ${kept} file(s) no longer shipped were kept because you edited them (? above)`)
   log(`[comfy-ts skill] 🟢 Claude Code commands: ${report.commands.join(' ')}`)
   log(`[comfy-ts skill] a session started before this skills folder existed needs /reload-skills`)
   return 0
}
