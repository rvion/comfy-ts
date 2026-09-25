// a failed run's error as ONE readable line. ComfyExecution stores ComfyUI's whole
// execution_error message; every client reads `error` as text
export function describeRunError(error: unknown): string {
   if (error == null) return 'execution failed'
   if (typeof error === 'string') return error
   if (error instanceof Error) return error.message
   if (typeof error === 'object') {
      const data = (error as { data?: unknown }).data
      if (typeof data === 'object' && data !== null) {
         const d = data as Record<string, unknown>
         if (typeof d.exception_message === 'string') {
            const where = typeof d.node_type === 'string' ? `${d.node_type} (node ${String(d.node_id)}): ` : ''
            const kind = typeof d.exception_type === 'string' && d.exception_type !== '' ? `${d.exception_type}: ` : ''
            return `${where}${kind}${d.exception_message.trim()}`
         }
      }
   }
   try {
      return JSON.stringify(error)
   } catch {
      return String(error)
   }
}
