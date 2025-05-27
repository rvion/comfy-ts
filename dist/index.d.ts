/**
 * Configuration options for the Calculator
 */
interface CalculatorOptions {
    /** Precision for decimal calculations */
    precision?: number;
    /** Whether to throw errors on invalid operations */
    strict?: boolean;
}
/**
 * Supported mathematical operations
 */
type MathOperation = "add" | "subtract" | "multiply" | "divide";
/**
 * Result of a mathematical operation
 */
interface CalculationResult {
    /** The computed value */
    value: number;
    /** The operation that was performed */
    operation: MathOperation;
    /** Input operands */
    operands: readonly number[];
}

/**
 * A simple calculator class demonstrating TypeScript library patterns
 *
 * @example
 * ```typescript
 * const calc = new Calculator({ precision: 2 })
 * const result = calc.add(1, 2)
 * console.log(result.value) // 3
 * ```
 */
declare class Calculator {
    private readonly options;
    /**
     * Creates a new Calculator instance
     * @param options - Configuration options
     */
    constructor(options?: CalculatorOptions);
    /**
     * Adds two or more numbers
     * @param operands - Numbers to add
     * @returns Calculation result
     * @throws Error when no operands provided and strict mode is enabled
     */
    add(...operands: number[]): CalculationResult;
    /**
     * Subtracts numbers from the first operand
     * @param first - Initial value
     * @param rest - Numbers to subtract
     * @returns Calculation result
     */
    subtract(first: number, ...rest: number[]): CalculationResult;
    private roundToPrecision;
}

/**
 * Formats a number as currency
 * @param amount - The amount to format
 * @param currency - Currency code (default: 'USD')
 * @returns Formatted currency string
 */
declare function formatCurrency(amount: number, currency?: string): string;
/**
 * Validates an email address using a simple regex
 * @param email - Email to validate
 * @returns True if email appears valid
 */
declare function validateEmail(email: string): boolean;

export { type CalculationResult, Calculator, type CalculatorOptions, type MathOperation, Calculator as default, formatCurrency, validateEmail };
