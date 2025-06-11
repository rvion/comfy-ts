export function jsEscapeStr(x: unknown): string {
   if (typeof x === 'string') return JSON.stringify(x)
   if (typeof x === 'number') return x.toString()
   if (typeof x === 'boolean') return x.toString()

   throw new Error(`jsEscapeStr: expected string, number, or boolean, got ${typeof x}`)
   // return x
}
