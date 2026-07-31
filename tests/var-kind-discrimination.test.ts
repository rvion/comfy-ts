import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'pathe'
import { applyVarPayload } from 'src/cli/serve/applyVarPayload.ts'
import { describeVar, renderDescriptorLine } from 'src/cli/serve/describeVar.ts'
import { type AnyVar, v } from 'src/vars/ComfyVars.ts'

// His repro 2026-07-31, from a consumer repo: every `POST /generate` payload
// override answered `var 'prompt' has unsupported kind 'text'`, for EVERY kind,
// and `GET /drafts` described an int var as `"payload": "string"`.
//
// Root cause: `instanceof`. The published package ships the var classes TWICE —
// dist/index.js (what a consumer's `.cflow.ts` imports) and the cli bundle's own
// chunk (what `comfy-ts serve` / `tui` run from) each define their own copies, so
// every `instanceof XVar` across that boundary is false. In-repo tests never saw
// it: one module graph, one class object.
//
// The fix is to discriminate on the `kind` string, which crosses bundles. This
// test is the guard on both halves: no instanceof in the cli, and every kind
// actually handled.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// derived from the source, never hand-listed: a future ColorVar must not be able to
// slip past this guard just because nobody remembered to add it here. Every exported
// class whose name ends in Var, plus the var errors caught in cli catch blocks.
const VAR_CLASSES: string[] = (() => {
   const src = readFileSync(join(repoRoot, 'src/vars/ComfyVars.ts'), 'utf8')
   const names = [...src.matchAll(/^export (?:abstract )?class (\w*(?:Var|VarEmptyError))\b/gm)].map((m) => m[1] ?? '')
   const found = names.filter((n) => n !== '' && !n.startsWith('ComfyVarBase'))
   if (found.length < 10) throw new Error(`var-class scan found only ${found.length} classes: ${found.join(', ')}`)
   return found
})()

function sourceFiles(dir: string, out: string[] = []): string[] {
   for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) sourceFiles(abs, out)
      else if (/\.tsx?$/.test(name)) out.push(abs)
   }
   return out
}

describe('vars are discriminated by kind, never by instanceof', () => {
   it('no cli code branches on `instanceof <VarClass>` (it is false across the shipped bundles)', () => {
      const offenders: string[] = []
      for (const abs of sourceFiles(join(repoRoot, 'src/cli'))) {
         const src = readFileSync(abs, 'utf8')
         src.split('\n').forEach((line, ix) => {
            for (const cls of VAR_CLASSES) {
               if (new RegExp(`instanceof\\s+${cls}\\b`).test(line))
                  offenders.push(`${relative(repoRoot, abs)}:${ix + 1} instanceof ${cls}`)
            }
         })
      }
      expect(offenders, `use \`.kind === '…'\` instead:\n${offenders.join('\n')}`).toEqual([])
   })

   it('applyVarPayload accepts a value for every var kind, and never says "unsupported kind"', () => {
      const cases: [string, AnyVar, unknown][] = [
         ['text', v.text('a'), 'hello'],
         ['prompt', v.prompt('a'), 'hello // note'],
         ['int', v.int(3, { min: 1, max: 9 }), 5],
         ['float', v.float(1.5), 2.5],
         ['seed', v.seed(1), 42],
         ['toggle', v.toggle(false), true],
         ['choice', v.choice(['a', 'b'], 'a'), 'b'],
         ['loras', v.loras([]), {}],
         ['size', v.size({ width: 512, height: 512 }), { width: 768, height: 768 }],
         ['image', v.image('/tmp/x.png'), '/tmp/y.png'],
      ]
      for (const [label, varDef, payload] of cases) {
         const err = applyVarPayload(varDef, payload)
         expect(err, `${label}: ${err}`).toBeNull()
      }
   })

   it('describeVar reports the real payload contract per kind, not the fallback string', () => {
      expect(describeVar(v.int(3, { min: 1, max: 9 })).payload).toContain('integer')
      expect(describeVar(v.float(1)).payload).toContain('number')
      expect(describeVar(v.seed(1)).payload).toContain('mode')
      expect(describeVar(v.toggle(true)).payload).toContain('true or false')
      expect(describeVar(v.choice(['a', 'b'], 'a')).choices).toEqual(['a', 'b'])
      expect(describeVar(v.size({ width: 1, height: 2 })).payload).toContain('width')
      expect(describeVar(v.image('/tmp/x.png')).payload).toContain('url')
      // a prompt is NOT a plain string: comments and negative lines are its contract
      expect(describeVar(v.prompt('x')).kind).toBe('prompt')
      expect(describeVar(v.prompt('x')).payload).toContain('negative')
      expect(describeVar(v.text('x')).payload).toBe('string')
   })

   it('an unknown kind from a newer comfy-ts degrades, it never crashes serve at startup', () => {
      // version skew is real once the library exists twice: a globally installed cli can
      // meet a var kind it has never heard of. printStartup runs BEFORE server.listen(),
      // so a throw here means no server at all, not a bad line of output
      const foreign = v.text('x')
      Object.defineProperty(foreign, 'kind', { value: 'color', configurable: true })
      const d = describeVar(foreign)
      expect(d.kind).toBe('color')
      expect(() => renderDescriptorLine('tint', d, 6)).not.toThrow()
      // and the payload error stays actionable, never a bare token
      expect(applyVarPayload(foreign, '#fff')).toContain('unsupported kind')
   })
})
