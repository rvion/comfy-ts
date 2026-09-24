// what the generate button shows. PURE, tests/serve-web-generate-button.test.ts. The text NEVER
// changes: a label carrying the percent changed the button's width on every tick and moved the
// row. The progress is a fill across the button, the exact percent lives on the running card

export function generateButtonLook(p: { isRunning: boolean; percent: number | null }): {
   label: string
   /** 0..100 while running, null when idle */
   fill: number | null
   running: boolean
} {
   return {
      label: 'generate',
      fill: p.isRunning ? Math.max(0, Math.min(100, Math.round(p.percent ?? 0))) : null,
      running: p.isRunning,
   }
}
