// esc is always CLAIMED by the page: a native window (sk gui's WKWebView) beeps on any key the
// page leaves unhandled, so a popup that closes on esc without preventDefault closes AND beeps.
// PURE, tests/serve-web-escape.test.ts guards that every esc handler of the panel goes through it

/** true when `e` was esc: claimed, then `close` ran */
export function onEscape(e: { key: string; preventDefault(): void }, close: () => void): boolean {
   if (e.key !== 'Escape') return false
   e.preventDefault()
   close()
   return true
}

/** the lines of a source that test for esc by hand instead of through onEscape */
export function rawEscapeChecks(source: string): string[] {
   return source.split('\n').filter((line) => /\.key\s*[!=]==?\s*['"]Escape['"]/.test(line))
}
