import type { Branded } from 'src/types/index.ts'

/**
 * a fake value that is detected at serialization
 * time to try to magically inject stuff
 * */
export type AUTO = Branded<{ ___AUTO___: true }, { AUTO: true }>

/**
 * you can use this as a placeholder anywhere in your graph
 * comfy-ts wires the most recent output of a matching type at serialization time
 */
// sanctioned cast (agent/coding.md): auto() is a SENTINEL detected at
// serialization time and replaced by a real link — it never survives to runtime
export const auto = <T>(): T => auto_ as T

export const auto_: AUTO = { ___AUTO___: true } as AUTO
