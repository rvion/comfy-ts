// #region Safety
export type Flavor<T, FlavorT> = T & { __tag?: FlavorT }
export type Tagged<O, Tag> = O & { __tag?: Tag }
export type Branded<O, Brand extends { [key: string]: true }> = O & Brand

// #region Utils
export type Maybe<T> = T | null | undefined
/**
 * Make some keys optional
 * Usage: PartialOmit<{ a: string, b: string }, 'a'> -> { a?: string, b: string }
 */
export type PartialOmit<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
export type IsEqual<T, S> = [T] extends [S] ? ([S] extends [T] ? true : false) : false
export type EmptyRecord = Record<never, never>

// #region Misc
export type number_Timestamp = Tagged<number, 'Timestamp'>

// #region Paths
export type AbsolutePath = Tagged<string, { AbsolutePath: true }>
export type RelativePath = Tagged<string, { RelativePath: true }>
export const asAbsolutePath = (path: string): AbsolutePath => path as AbsolutePath
export const asRelativePath = (path: string): RelativePath => path as RelativePath

// #region Image
export type ConvertibleImageFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'raw'
/** local disk saving is OPT-IN per run: `save: true` = raw bytes, an object re-encodes/relocates */
export type SaveOptions = {
   /** 'raw' (default) writes the bytes untouched; an image/* mime re-encodes through sharp */
   format?: ConvertibleImageFormat
   /** local dir under `.comfy-ts/outputs/` (wins over the prompt's own filename_prefix) */
   prefix?: string
   /** 0..1, re-encode only */
   quality?: number
}

// #region Either
export type Either<L, R> = { success: false; value: L } | { success: true; value: R }
export const resultSuccess = <T>(value: T): Either<never, T> => ({ success: true, value })
export const resultFailure = <T>(value: T): Either<T, never> => ({ success: false, value })

// #region Result
export type ResultFailure = { success: false; message: string; error: unknown; value: undefined }
export type Result<R> = { success: true; value: R } | ResultFailure
export const __OK = <T>(value: T): Result<T> => ({ success: true, value })
export const __FAIL = (message: string, error?: unknown): Result<any> => ({
   success: false,
   message,
   error,
   value: undefined,
})

// #region Markdown
export type MDContent = Branded<string, { MDContent: true }>
export const asMDContent = (s: string): MDContent => s as MDContent

// #region HTML
export type HTMLContent = Branded<string, { HTML: true }>
export const asHTMLContent = (s: string): HTMLContent => s as HTMLContent
