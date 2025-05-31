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

export type Flavor<T, FlavorT> = T & { __tag?: FlavorT }
export type Tagged<O, Tag> = O & { __tag?: Tag }
export type Branded<O, Brand extends { [key: string]: true }> = O & Brand
export type Maybe<T> = T | null | undefined
export type Timestamp = Tagged<number, 'Timestamp'>

/**
 * Make some keys optional
 * Usage: PartialOmit<{ a: string, b: string }, 'a'> -> { a?: string, b: string }
 */
export type PartialOmit<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
export type IsEqual<T, S> = [T] extends [S] ? ([S] extends [T] ? true : false) : false

export type EmptyRecord = Record<never, never>
export type AbsolutePath = Branded<string, { AbsolutePath: true }>

export type ConvertibleImageFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'raw'
export type ImageSaveFormat = {
   format: ConvertibleImageFormat
   prefix?: string
   quality?: number
}
