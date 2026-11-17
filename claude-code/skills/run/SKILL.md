---
description: Generate with comfy-ts, one headless run of a *.cflow.ts workflow module or a bundled example through comfy-ts run, returning the output files. Use when the user wants an image, video, audio or text generated.
argument-hint: "[module] [--var value ...]"
---

Generate with comfy-ts: $ARGUMENTS

1. Find the module: `bunx comfy-ts run` lists the modules of the cwd and the bundled examples. A path, a module key, the key without its number, or a unique part of it selects one. A bundled example runs on the host its file declares, so prefer the project's own modules.
2. Read its vars: `bunx comfy-ts run <module> --help`. Each var is a flag; pass only the vars the request changes. `--<var>-file <path>` reads a long text var from a file.
3. Run: `bunx comfy-ts run <module> --<var> <value> --out <path> --json`. The one JSON line carries `ok` and the absolute `outputs`.
4. A failed run exits 1 with the reason (host down, missing model, bad value). Report it as given; never retry with invented values.
5. Look at an image output before you say it worked, then give the user the paths.
