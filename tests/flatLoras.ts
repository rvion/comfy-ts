import { isLoraLanes, type LoraRecord, type LorasInput } from 'src/vars/lanes.ts'

/** a loras value in its flat record form; throws on lanes, which these cases never set */
export function flatLoras<T extends string>(v: LorasInput<T>): LoraRecord<T> {
   if (isLoraLanes(v)) throw new Error('expected the flat record form, got lanes')
   return v
}
