# shipkit ci fixers rewrote comfy-ts config on a plain gate run

- What broke: one `shipkit ci` run in comfy-ts (a published npm library) applied its autofixes. SK001 rerouted the `test`/`lint`/`typecheck` scripts to `bun src/cli/comfy-ts-cli.ts ci --only …`. It took the repo's own cli for shipkit, and that command does not exist. SK013 added deny rules for `bun test`/`tsc` and a PreToolUse hook to .claude/settings.json. The .vscode/tasks.json TSC watcher was deleted, and a gitignore policy block was added. All of this was reverted by hand.
- Still red after that, and wrong for this repo: SK001 requires `"private": true` and bans `license` (this package is on npm), SK004 wants to move .rv-journal/ into .shipkit/, SK007 is visibility, and typecheck fails because repo.config.ts imports rvlib-shipkit, which does not resolve here.
- Expected: `shipkit ci` as "THE command" should not rewrite a library repo's scripts and agent settings on a check run, or the repo should declare itself a library so SK001 does not apply project rules.
- Pages: build/shipkit.md (SK001, SK013 fix policy), identity/how-we-work.md Verification ("shipkit ci is THE command").
