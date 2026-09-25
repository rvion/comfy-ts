import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'pathe'

/**
 * Draft names are private: they name what someone is prompting. The drafts live under the
 * gitignored `.comfy-ts/drafts/`, and their NAMES must not leak into a tracked file either (a
 * test fixture that borrows a real draft name is the usual way). This guard reads the names of
 * the drafts on this machine and fails when a tracked file spells one. With no drafts on disk
 * (a fresh clone, CI) it has nothing to compare and passes.
 */
const ROOT = join(import.meta.dir, '..')

/** names that say nothing about anyone: the defaults the tools write themselves */
function isGenericDraftName(name: string): boolean {
   return name.length < 5 || /^(default|new( \d+)?|draft-\d+|copy( \d+)?)$/.test(name)
}

function localDraftNames(): string[] {
   const dir = join(ROOT, '.comfy-ts', 'drafts')
   if (!existsSync(dir)) return []
   const names = new Set<string>()
   for (const mod of readdirSync(dir, { withFileTypes: true }))
      if (mod.isDirectory())
         for (const f of readdirSync(join(dir, mod.name)))
            if (f.endsWith('.json')) names.add(f.slice(0, -'.json'.length))
   return [...names].filter((n) => !isGenericDraftName(n))
}

describe('no private draft name in a tracked file', () => {
   it('the defaults the tools write are not private; anything else is', () => {
      for (const n of ['default', 'new', 'new 2', 'draft-1', 'copy']) expect(isGenericDraftName(n)).toBe(true)
      for (const n of ['rooftop-portrait-3', 'sheep fun 2']) expect(isGenericDraftName(n)).toBe(false)
   })

   it('no tracked file spells a draft name from this machine', () => {
      const names = localDraftNames()
      if (names.length === 0) return
      let out = ''
      try {
         out = execFileSync('git', ['grep', '-l', '-F', ...names.flatMap((n) => ['-e', n])], { cwd: ROOT, encoding: 'utf8' })
      } catch (e) {
         // git grep exits 1 when nothing matches: that is the passing case
         if ((e as { status?: number }).status === 1) return
         throw e
      }
      expect(out.trim().split('\n')).toEqual([])
   })
})
