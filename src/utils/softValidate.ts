import { type Type, type } from 'arktype'
import { printArkResultInConsole } from 'src/utils/printArkResultInConsole.ts'

export const softValidate = <T>(schema: Type<T>, stuff: unknown): T => {
   const res = schema(stuff)
   if (res instanceof type.errors) printArkResultInConsole(res)
   return stuff as T
}
