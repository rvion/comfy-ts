import { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'

/**
 * instanceof first; duck-type fallback covers a second copy of the library in
 * the module graph (linked dev setups, npm dedupe misses)
 */
export function findDefinedWorkflow(mod: Record<string, unknown>): DefinedWorkflow | null {
   const isDefined = (x: unknown): x is DefinedWorkflow =>
      x instanceof DefinedWorkflow ||
      (typeof x === 'object' &&
         x != null &&
         'spec' in x &&
         typeof (x as DefinedWorkflow).run === 'function' &&
         typeof (x as DefinedWorkflow).entries === 'function')
   return [mod.default, ...Object.values(mod)].find(isDefined) ?? null
}
