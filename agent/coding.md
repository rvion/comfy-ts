# Coding standards (comfy-ts)

## Spec-first (hard)

Update the matching `agent/` doc BEFORE code. Renaming a file, moving a responsibility, or changing a frozen invariant → `architecture.md` first.

## Stack pins (closed list)

Runtime deps: `arktype`, `image-meta`, `nanoid`, `pathe`, `sharp`, `ws`, `ink` + `react` + `react-dom` + `mobx` + `mobx-react-lite` (the TUI, added 2026-07-24). (terminal-image was tried and dropped 2026-07-24: v5 hard-emits the iTerm image protocol under iTerm/VSCode which ink mangles — `src/utils/ansiImage.ts` renders half-block ANSI with sharp instead.) Dev: `typescript` (v7, tsgo-native), `tsdown`, `oxlint`, `oxfmt`, `oxlint-tsgolint`, `rvlib-ts-tools`, `@types/bun`, `@types/ws`. (tsdown replaced tsup 2026-07-24: typescript@7 dropped the JS compiler API tsup's dts bundling needs; tsdown emits dts through tsgo itself.) New dep = a decision. First ask: can ~20 lines of current code do it? (house example: `src/utils/ansi.ts` replaced chalk).

## TypeScript

- absolute repo-root imports WITH extension: `from 'src/utils/bang.ts'` — never relative. `bun run imports:fix` self-heals; `imports:check` is the CI gate.
- `strict` + `noUncheckedIndexedAccess` + nodenext. `bun run typecheck:lib` (src + scripts) must stay at 0 errors WITHOUT any generated sdk.d.ts on disk — base types in `src/types/comfy-sdk.ts` self-suffice, and `bun run ci` uses that config so the gate matches a fresh clone. examples/ need a generated host sdk by construction: `bun run typecheck` (full, local) covers them, `bun run ci:local` = ci + that.
- NO `any`, `as any`, `as unknown as X`, `@ts-ignore`.
- **Cast whitelist** (each individually justified, do not add without updating this list):
  1. runtime graph ↔ generated sdk face: `workflow.builder`/`builderBase`, `ComfyNode.inputs/outputs` wiring, `MediaImage` NodeOf helpers, and the vars-lambda `v as BoundVars<ID>` injection + `LorasVar.bindHost` regex resolution (`v.loras(regex)` claims the generated E_LoraName union) — the runtime objects are built dynamically from the SAME object_info the generated types come from.
  2. `as<T>()` refinements on arktype schemas and `asXxx()` brand constructors — brands only.
  3. `globalThis as { comfyts?: ComfyTS }` in `src/state.ts` — global registration.
  4. wire tolerance: ws messages / manager endpoints are ark-soft-validated then cast — ComfyUI drifts faster than our schemas; failures are LOGGED first (`ComfyHost.onMessage`, `ComfyHost.fetchRawLogs`, `ComfyManager.fetch*` without validator).
  5. sentinels: `auto()` returns a marker object replaced at serialization time (`src/graph/autoValue.ts`).
  6. kind-discriminated `ComfyVar` narrowing (`sel as ToggleVar` after checking `kind`) — value-invariance blocks a clean union (`src/cli/tui/state/`, `src/cli/tui/imagePicker/`).
  7. host registry reuse: `comfyts.host({id})` returns the ALREADY-registered instance for that id as `ComfyHost<ID>` — the runtime id equality is checked right before the cast (`src/state.ts`).
  8. stdout.write monkey-patch in the TUI protocol-image painter: the wrapper reimplements the exact overload set, then is cast to `typeof process.stdout.write` (`src/cli/tui/protocolImagePainter.ts`).
  9. serve payload validation: after every entry of a POST body value is runtime-checked (`isLoraStrength`, key ∈ options), the record is claimed as the var's value type (`src/cli/serve/applyVarPayload.ts`) — same wire-tolerance family as 4, but the check is COMPLETE, not soft.
  10. runtime-boundary probes of the web entry (architecture item 13), each null-checked right after: `process.getBuiltinModule('node:fs')` results claimed as the structural NodeFsLike/NodeOsLike faces and node `readFileSync(p,'utf8')` as string (`src/storage/ComfyStorage.ts`); VARIABLE-specifier dynamic imports (typed as any by tsc) claimed as their module shapes (`src/host/ResilientWebsocket.ts` ws ctor, `src/utils/lazySharp.ts`); `globalThis` probes for WebSocket and the comfyts storage backref (`ResilientWebsocket.ts`, `ComfyStorage.ts` — extends family 3 beyond src/state.ts).
- Known violations to burn down (documented, do NOT replicate): scattered `as any` in `ComfyNode._convertPromptExtToPrompt` / dynamic outputs wiring; `softValidate`/`bong` returning lying casts on failure (both documented at the definition); manager generated unions claimed via `.as<T>()` without membership checks (live data may legitimately contain values newer than the generated union). (`ComfyRegistry` built-in `as any` seed burned down 2026-07-30: the pseudo-plugin is seeded into byTitle/byFile BEFORE codegen so its literals are union members.)
- params named `p`, no destructuring in params/bodies (`p.hostId`), `== null` checks, early returns, classes for stateful things.

## Lint & format config (zero output is the contract)

`bun run lint` must print NOTHING. A permanent warning stream trains everyone to ignore the one warning that matters, so a warning is either fixed or the rule is turned off ON PURPOSE in `.oxlintrc.json`. Currently off, each because the house style disagrees, not because the code is wrong:

- `eslint/no-shadow` — every param is `p` and tests re-import inside `it()`.
- `eslint/no-new` — `new ComfyExecution(...)` self-registers with its host; the instance IS the side effect.
- `oxc/no-this-in-exported-function` — exported layout helpers are called as methods, deliberately.
- `unicorn/no-array-sort` / `no-array-reverse` — mutating a local array we just built is fine and cheaper than a copy.
- `unicorn/consistent-function-scoping` — locals stay next to their only caller.
- `unicorn/prefer-add-event-listener` — `ws` exposes `on*` handlers.
- `eslint/no-control-regex`, `src/utils/ansi.ts` ONLY (override) — stripAnsi matches ESC on purpose; everywhere else the rule stays on.
- `unicorn/require-module-specifiers`, `examples/comfy-cloud/sdk.d.ts` ONLY (override) — the generated sdk ends with `export {}` to force module-ness; generated files are never hand-edited, so the warning is unfixable there.

Formatting ignores live in `.prettierignore` (oxfmt reads it, so does the VSCode oxc extension): captured fixtures and upstream json mirrors are DATA, never restyled; `src/manager/generated/**` is formatted on purpose, as the last step of `gen:manager`.

## Naming

- generated files are never edited by hand (`src/manager/generated/`, `.comfy-ts/hosts/*/sdk.d.ts`).
- `nodeKey` = the qualified node key (`impact-pack.FaceDetailer`) — legacy CushyStudio naming kept for now; if you rename it, sweep the WHOLE repo + codegen in one commit.
- explicit filenames, one concern per file, new files ≤ ~600 lines.

## Errors

Never fail silently. Loud console + thrown Error. `bang(x, msg)` for invariants. No toast-style stubs — `src/utils/log.ts` is the logger.

## Comments — caveman

Default = NO comment. Comment only the WHY. No change-narration; git + `.rv-journal/changelog.md` own history.

## Markdown — no hard wraps (his rule 2026-07-31)

One line per paragraph and per bullet, however long. Never cut a sentence with a newline to respect an invisible line width: editors soft-wrap, renderers reflow, and grep needs the phrase whole. Code fences, tables and frontmatter keep their own line structure. `agent/external-docs/` is excluded: those pages are upstream mirrors, DATA, never restyled (same rule as the json fixtures). `tests/markdown-no-hard-wraps.test.ts` is the guard and runs in `bun run ci`.

## Tests

`bun test`, headless, all under `tests/`. Repro test BEFORE a fix. Codegen changes must keep the snapshot test green (`tests/codegen.test.ts`) — regenerate fixtures deliberately, never accidentally.

## Boring wins

Prefer 20 more lines of obvious code over a new abstraction or dependency.
