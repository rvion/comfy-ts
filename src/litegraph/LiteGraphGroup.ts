import { type } from 'arktype'
import type { EmptyRecord, IsEqual } from 'src/types/index.ts'

// prettier-ignore
export type LiteGraphGroup = {
   id?: number //       1 (newer serializers only)
   title: string //     'Create Mask'
   bounding: [number, number, number, number] //  [1078, -579, 1589, 614]
   color?: string //    '#3f789e' (omitted = litegraph default)
   font_size?: number //  24 (omitted = litegraph default)
   flags?: EmptyRecord // {}
}

export const LiteGraphGroup_ark = type({
   'id?': 'number',
   title: 'string',
   bounding: type(['number', 'number', 'number', 'number']),
   'color?': 'string',
   'font_size?': 'number',
   // EmptyRecord: an object we don't read any key from
   'flags?': type.Record('string', 'unknown').as<EmptyRecord>(),
})

true satisfies IsEqual<LiteGraphGroup, typeof LiteGraphGroup_ark.infer>
