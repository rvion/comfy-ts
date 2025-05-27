/**
 * A modern TypeScript utility library
 * @packageDocumentation
 */

export * from "./types/index"
export { Calculator } from "./calculator"
export { formatCurrency, validateEmail } from "./utils"

// Default export
export { Calculator as default } from "./calculator"
