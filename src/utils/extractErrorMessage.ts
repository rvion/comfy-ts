/** Extracts an error message from an exception stuff. */
export const extractErrorMessage = (error: unknown): string => {
   if (error instanceof Error) return error.message
   if (error === null) return 'null'
   if (typeof error === 'string') return error
   if (typeof error === 'object') {
      if ('message' in error && typeof error.message === 'string') return error.message
      return JSON.stringify(error)
   }
   return String(error)
}
