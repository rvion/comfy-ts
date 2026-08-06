// `RegExp.test` on a /g or /y regex ADVANCES lastIndex, so the same pattern gives different
// answers on consecutive calls. A user-supplied filter (`v.loras(/krea2/gi)`) is reused across
// call sites, which turned one filter into two different result sets.
export function matchesRegex(re: RegExp, value: string): boolean {
   if (!re.global && !re.sticky) return re.test(value)
   // stateless by construction: resetting lastIndex would still race two interleaved loops
   return new RegExp(re.source, re.flags.replace(/[gy]/g, '')).test(value)
}
