// RegExp.test on a /g or /y regex advances lastIndex, so the same pattern answers differently
// on consecutive calls. A user-supplied filter is shared by several call sites.
export function statelessRegex(re: RegExp): RegExp {
   if (!re.global && !re.sticky) return re
   // sticky means "match AT lastIndex": dropping the flag would drop the anchoring too, and a
   // filter written as /krea/y would silently widen from starts-with to contains
   const source = re.sticky ? `^(?:${re.source})` : re.source
   return new RegExp(source, re.flags.replace(/[gy]/g, ''))
}

export function matchesRegex(re: RegExp, value: string): boolean {
   return statelessRegex(re).test(value)
}
