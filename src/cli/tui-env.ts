// contract between the TUI and workflow modules: the TUI sets this env var
// before importing a module; example files also use `import.meta.main` to
// only self-run when executed directly.
export const COMFY_TS_TUI_ENV = 'COMFY_TS_TUI'

export function isTuiActive(): boolean {
   return process.env[COMFY_TS_TUI_ENV] === '1'
}
