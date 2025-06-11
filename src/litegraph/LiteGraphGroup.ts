import { type } from 'arktype'
import type { EmptyRecord, IsEqual } from '../types'

// prettier-ignore
export type LiteGraphGroup = {
   title: string //  'Create Mask'
   bounding: [number, number, number, number] //  [1078, -579, 1589, 614]
   color: string //  '#3f789e'
   font_size: number //  24
   flags: EmptyRecord //  {}
}

export const LiteGraphGroup_ark = type({
   title: 'string',
   bounding: type(['number', 'number', 'number', 'number']),
   color: 'string',
   font_size: 'number',
   flags: type.Record('never', 'never'),
})

true satisfies IsEqual<LiteGraphGroup, typeof LiteGraphGroup_ark.infer>
