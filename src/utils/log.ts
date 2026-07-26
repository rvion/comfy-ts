// loud console logging; errors must be observable to human AND LLM.
// COMFY_TS_QUIET=1 (set by drivers like the TUI) silences INFO chatter only —
// errors always print.
export const isQuiet = (): boolean => process.env.COMFY_TS_QUIET === '1'
export const logInfo = (msg: string): void => {
   if (!isQuiet()) console.log(msg)
}
export const logError = (msg: string): void => console.error(`[comfy-ts] 🔴 ${msg}`)
export const logSuccess = (msg: string): void => console.log(`[comfy-ts] 🟢 ${msg}`)
