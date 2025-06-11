/* please, keep this file as minimal as possible; it's imported by many apps */
export function logStackTrace(): void {
   const err = new Error('Stack trace')
   console.error(err.stack)
}
