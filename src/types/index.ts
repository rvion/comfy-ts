/** Configuration options for the Calculator */
export interface CalculatorOptions {
   /** Precision for decimal calculations */
   precision?: number
   /** Whether to throw errors on invalid operations */
   strict?: boolean
}

/** Supported mathematical operations */
export type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide'

/** Result of a mathematical operation */
export interface CalculationResult {
   /** The computed value */
   value: number
   /** The operation that was performed */
   operation: MathOperation
   /** Input operands */
   operands: readonly number[]
}
