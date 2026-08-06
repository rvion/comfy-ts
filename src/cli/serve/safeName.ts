// THE name gate for every serve route that turns a url segment into a file path.
// SECURITY-CRITICAL and deliberately shared: handle() decodes per segment, so
// `%2F` arrives as a real `/` while the segment count still looks right. One
// function, because a second regex somewhere else is a second traversal hole.

/** the accepted name, or null. Rejects traversal, absolute paths, leading dots and empties */
export function validStoreName(raw: string): string | null {
   const name = raw.trim()
   // length cap: past it the fs answers ENAMETOOLONG as a raw 500
   if (name.length > 100) return null
   return /^[\w][\w .-]*$/.test(name) ? name : null
}

/** a save prefix becomes a PATH under outputs/, so every segment goes through the same gate:
 * it cannot climb out, and it cannot be absolute. Lives here, not on ServeApp, because the
 * settings READER validates it too — a hand-written settings file never met the PUT route. */
export function validSavePrefix(raw: string): string | null {
   const clean = raw.trim().replaceAll('\\', '/')
   if (clean === '') return ''
   // an ABSOLUTE path is refused, not quietly re-rooted: dropping the leading slash turned
   // '/etc' into 'etc' under outputs/, which is safe but is not what the writer asked for
   if (clean.startsWith('/') || /^[a-z]:/i.test(clean)) return null
   const segments = clean.split('/').filter((s) => s !== '')
   if (segments.length === 0 || segments.some((s) => validStoreName(s) == null)) return null
   return segments.join('/')
}
