import type { Maybe } from 'src/types/index.ts'

/** assertNotNull */
export const bang = <T>(x: Maybe<T>, msg: string = ''): T => {
   if (x == null) {
      console.error(`[🔴] BANG FAILED`, msg)
      throw new Error('bang: ' + (msg ?? 'no message'))
   }
   return x
}

/** soft assertNotNull — LIES on failure: logs then returns the null as T. Prefer bang(). */
export const bong = <T>(x: Maybe<T>, msg: string = ''): T => {
   if (x == null) {
      console.error(`[🔴] BONG FAILED`, msg)
      return x as T
   }
   return x
}

export function ASSERT_ARRAY(a: unknown): a is unknown[] {
   if (!Array.isArray(a)) throw new Error('❌ not an array')
   return true
}

export function ASSERT_EQUAL(a: unknown, b: unknown): a is unknown[] {
   if (a !== b) throw new Error('❌ not equal')
   return true
}

// ----------
export function ASSERT_STRING(a: unknown): a is string {
   if (typeof a !== 'string') throw new Error('❌ not a string')
   return true
}
export function asSTRING_orCrash(a: unknown, errMsg: string = '❌ not a string'): string {
   if (typeof a !== 'string') throw new Error(errMsg)
   return a
}
