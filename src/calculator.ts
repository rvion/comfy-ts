import type { CalculatorOptions, CalculationResult, MathOperation } from "./types"

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
export class Calculator {
    private readonly options: Required<CalculatorOptions>

    /**
     * Creates a new Calculator instance
     * @param options - Configuration options
     */
    constructor(options: CalculatorOptions = {}) {
        this.options = {
            precision: options.precision ?? 2,
            strict: options.strict ?? true,
        }
    }

    /**
     * Adds two or more numbers
     * @param operands - Numbers to add
     * @returns Calculation result
     * @throws Error when no operands provided and strict mode is enabled
     */
    add(...operands: number[]): CalculationResult {
        if (operands.length === 0 && this.options.strict) {
            throw new Error("At least one operand required")
        }

        const value = this.roundToPrecision(operands.reduce((sum, num) => sum + num, 0))

        return {
            value,
            operation: "add",
            operands: Object.freeze([...operands]),
        }
    }

    /**
     * Subtracts numbers from the first operand
     * @param first - Initial value
     * @param rest - Numbers to subtract
     * @returns Calculation result
     */
    subtract(first: number, ...rest: number[]): CalculationResult {
        const value = this.roundToPrecision(rest.reduce((diff, num) => diff - num, first))

        return {
            value,
            operation: "subtract",
            operands: Object.freeze([first, ...rest]),
        }
    }

    private roundToPrecision(value: number): number {
        return Math.round(value * Math.pow(10, this.options.precision)) / Math.pow(10, this.options.precision)
    }
}
