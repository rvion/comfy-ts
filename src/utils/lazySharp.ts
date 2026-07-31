// sharp is node-only; the web graph must never carry it (architecture item 13).
// The import specifier is a VARIABLE on purpose: bundlers cannot statically
// chase it, so browser builds of comfy-ts/web don't try to resolve sharp —
// in a browser the import throws at runtime and callers get the loud error.
import type SharpNS from 'sharp'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'

export type SharpModule = typeof SharpNS

let cached: SharpModule | null = null

export async function importSharp(reason: string): Promise<SharpModule> {
   if (cached != null) return cached
   const specifier = 'sharp'
   try {
      const mod = (await import(specifier)) as { default: SharpModule }
      cached = mod.default
      return cached
   } catch (e) {
      throw new Error(
         `sharp is unavailable — ${reason} is node-only (browser builds get raw bytes instead): ${extractErrorMessage(e)}`,
         { cause: e },
      )
   }
}
