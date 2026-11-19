// the app take: the staged workflow the trailer runs (stage/scenery.cflow.ts) gains two variables and two ifs, typed
// into the file until it reads exactly as the file on disk, which the terminal and the panel then run as an app.
// No host types here (the staged host's schema is private): the file compiles on comfy-ts's own base types.
const LINES = [
   // [the line the new one follows, the new line without its indent]
   ["      seed: v.seed(7, { mode: '+' }),", "night: v.toggle(false, 'night'),"],
   ["      night: v.toggle(false, 'night'),", "upscale: v.toggle(false, 'upscale 2x'),"],
   ['      let text = `masterpiece, best quality, safe, no humans, scenery, ${vars.prompt.positive}`', "if (vars.night) text += ', night, moonlight'"],
   ["      let image = b.VAEDecode({ samples, vae: b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' }) })._IMAGE", "if (vars.upscale) image = b.ImageScaleBy({ image, upscale_method: 'lanczos', scale_by: 2 })._IMAGE"],
]
// when each new line starts and how fast it types, on the cut's clock
const STARTS = [[0.35, 0.03], [1.65, 0.03], [3.2, 0.028], [5.0, 0.022]]

;(async () => {
   const final = await (await fetch('/stage/scenery.cflow.ts')).text()
   const start = LINES.reduce((code, [, line]) => code.replace(`\n      ${line}`, ''), final)
   if (start === final) throw new Error('app take: the staged file does not hold the new lines')
   playEvents([
      ...LINES.flatMap(([after, line], i) => [
         { t: STARTS[i][0], run: async () => { at(offsetOf(after) + after.length); type('\n      ') } },
         ...keys(STARTS[i][0] + 0.12, STARTS[i][1], line),
      ]),
      // the last frame: the file reads exactly as the one the app runs
      { t: 7.4, run: async () => { if (model.getValue() !== final) throw new Error('app take: the typed file differs from stage/scenery.cflow.ts') } },
   ])
   openTake({
      code: start,
      file: 'scenery.cflow.ts',
      libs: { '/lib/comfy-ts.d.ts': 'file:///node_modules/comfy-ts/index.d.ts', '/lib/stage-sdk.d.ts': 'file:///.comfy-ts/hosts/my-gpu/sdk.d.ts' },
      // typing only: no list opens on a dot, no key accepts one
      options: { fontSize: 15.5, lineHeight: 22, stickyScroll: { enabled: false }, suggestOnTriggerCharacters: false, acceptSuggestionOnCommitCharacter: false, autoClosingBrackets: 'never', autoClosingQuotes: 'never', autoIndent: 'none' },
      ready: async () => {
         editor.revealLineNearTop(5)
         editor.setScrollTop(editor.getTopForLineNumber(5))
         at(offsetOf(LINES[0][0]) + LINES[0][0].length)
      },
   })
})()
