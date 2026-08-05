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
