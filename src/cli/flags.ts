/**
 * the CLI's one flag reader: `--name value`.
 * A flag written with no value after it is a TYPO, never a request for the
 * default — silently falling back would run against the wrong host.
 */
export function flagReader(args: string[]): (name: string) => string | null {
   return (name: string): string | null => {
      const ix = args.indexOf(`--${name}`)
      if (ix < 0) return null
      const value = args[ix + 1]
      if (value == null || value.startsWith('--')) throw new Error(`--${name} needs a value`)
      return value
   }
}
