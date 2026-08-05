# comfy-ts

## 2.7.0

### The prompt refiner runs on a local model too

- **Open WebUI is a second provider**, so the refiner can run on a model on your own box instead of a cloud one. Pick the provider in the modal, point it at your Open WebUI URL, and the API key is optional for a box that has no auth. Keys, base URL and selected model are kept per provider, so switching never sends a cloud model id to a local server.
- **A local model's `<think>` block never lands in your prompt.** Reasoning models served through Open WebUI stream their thinking inline with the answer; it is split out into the thinking pane, including when a tag arrives split across two chunks.
- **The model list no longer comes up empty on a local server.** Open WebUI does not report per-model capabilities, so "thinking only" now hides only models that explicitly report no reasoning support, instead of everything whose support is unknown. Reasoning effort is sent to OpenRouter only, since a local backend rejects the field.
- **Master prompts are files: `.comfy-ts/prompt-enhancers/<name>.md`**, beside your drafts. Edit them in your editor or in the modal, where they autosave to disk. They are markdown, because a master prompt is a paragraph you want to read. New, duplicate, rename and delete act on the files. Upgrading from 2.6.0: master prompts previously lived in browser storage and are not carried over, and the folder is seeded with `refine-krea2-prompt.md` the first time the modal opens.
- A provider that cannot be reached now says which URL failed and that a local server needs `CORS_ALLOW_ORIGIN` set, instead of reporting a bare "failed to fetch".

### Serve

- **`comfy-ts serve --host 0.0.0.0` for another machine** — your phone, or a tailnet peer. Bound beyond localhost, the startup print lists every address the machine answers on, with tailscale addresses labelled, so you can copy the URL instead of looking it up. `--bind` keeps working as the same flag, and the no-auth warning still prints on every non-loopback launch.
- **Delete a draft from the web panel.** The form header's delete removes the draft file through `DELETE /drafts/<module>/<draft>`; deleting `default` resets it to the workflow's own values rather than losing anything.
- New routes: `GET /prompt-enhancers` lists the master prompts, `PUT /prompt-enhancers/<name>` writes one, `DELETE /prompt-enhancers/<name>` removes it. Enhancer names go through the same check as draft names, so a name in the URL cannot escape the folder.

## 2.6.0

`comfy-ts serve` grows a web control panel: open the same URL in a browser and every var of every draft is a real form control, with your edits saved back into the draft the TUI reads.

### Security

- **Fixed: a draft name in the URL could escape the drafts folder.** `GET /drafts/<module>/<draft>` and `POST /generate/<module>/<draft>` built a file path straight from the URL segment, so a percent-encoded separator (`..%2F..%2Fsomething`) read any `.json` file the serve process could reach: the GET returned its contents, and the POST loaded it as the run's variable values. Since the API answers with permissive CORS headers, any page open in your browser could do this while `comfy-ts serve` was running. Present in every version since 1.3.0, when serve landed. All four draft routes now share one name check, and anything outside it is a 404. If you have run `comfy-ts serve` on a machine with untrusted browsing, this is the release to take.

### The web panel

- **Every var kind has its control**: prompt textarea (with the `//` comment and `- ` negative line hints), sliders for ranged numbers, seed mode buttons (fixed, +1, -1, random) with a dice roll, size presets plus free `W×H`, image path/URL with browser upload, preview and clear, and a lora palette (below). Cmd+Enter or Ctrl+Enter generates from anywhere.
- **Drafts are live, like the TUI.** Edits autosave into the selected draft, so a prompt you type in the browser is there after a reload and in the TUI. Drafts duplicate from the form header. Nothing is lost when you switch drafts or close the tab mid-edit.
- **Queue.** Every click on generate queues another prompt; the queue panel lists them and drops any pending one individually or all at once. A queued prompt keeps the values you saw when you clicked, while seeds follow the draft's own policy, so a queue of four under `random` gives four different images.
- **Live feedback while running**: a progress bar and the latent preview, straight from the host.
- **Loras as a palette.** The row holds the loras you picked and nothing else: click a card to pause or resume it in place, adjust model and clip strength inline, and the popup is where you browse everything as a gallery of preview images with the model names and trigger words from your lora mirror. Images and titles each have a persistent hide toggle.
- **Results gallery**: click any image for a lightbox with copy to clipboard, open in a tab and delete; results clear individually or all at once.
- **Works on a phone**: collapsible menu, touch-sized controls, results below the form instead of beside it.
- The panel ships prebuilt in the package and needs no build step, no extra dependency and no network: the JSON API is unchanged and still the only thing a non-browser client sees.

### Prompt refiner

- **A ✨ button on every prompt var** opens a refine modal that rewrites your prompt through a thinking model on OpenRouter, streaming both the answer and the model's reasoning. Master prompts live in a named library you can add to, rename, duplicate and delete, and the one you used last is remembered per workflow; one refiner for Krea 2 ships as a starting point. Nothing touches your prompt until you press apply, and the original stays beside the rewrite for a second pass. Your OpenRouter key is stored in the browser and sent only to OpenRouter: the serve process never receives it.

### New HTTP routes

- `PUT /drafts/<module>/<draft>` writes a draft (the panel's autosave and duplicate ride it). `GET /run/<module>` reports the live run, `GET /run/<module>/preview` serves its latest latent frame. `POST /upload` stores a browser file for an image var. `GET /lora-info/<host>/<lora>` and `GET /lora-preview/<host>/<lora>` serve a lora's display name, trigger words and preview image from your local mirror.

### TUI

- **Kitty graphics protocol support in the preview panel.** Kitty and Ghostty showed half-block ANSI art because detection only knew the OSC 1337 terminals; they now get real images, with PNG transcoding where the protocol requires it. `COMFY_TS_NO_ITERM_IMAGES=1` still disables images in every terminal.
- Fixed: an image previewed from one overlay could land in another one opened while it was still loading.

### Fixes

- **A seed mode no longer leaks between drafts.** After running a draft set to random, other drafts of the same workflow reported random as their default; with the web panel autosaving, that could be written into their files and silently turn a fixed seed into a rolling one.
- **Latent previews follow the right workflow.** Two workflows generating on one host could show each other's preview image; frames are now matched to the prompt that produced them.
- `SeedVar` exposes `defaultMode`, the mode a reset restores, so introspection reports the specification's default rather than whatever the last run left behind.

## 2.5.0

- **MobX 7 + mobx-react-lite 5.** The deps move to `mobx@^7` and `mobx-react-lite@^5` (React 18+). MobX 7 removed the annotation namespace, so the TUI store annotates with the named `observableRef` export instead of `observable.ref`. The factory forms this package uses elsewhere (`observable.map`) are unchanged, and the public API is untouched.
- If your app pins MobX 6 in the same dependency tree as comfy-ts, stay on 2.4.2: two MobX copies in one tree make every observable invisible across the boundary ("There are multiple, different versions of MobX active").

## 2.4.2

Three ways `comfy-ts loras` could report success while quietly losing loras. All present in 2.4.0 and 2.4.1.

- **Fixed: a truncated sweep was written as if complete.** If the host returned an empty page while its own `total` said more loras were coming, the sweep counted as finished and the partial result overwrote your mirror — printing a green summary and listing the dropped loras as "gone from the host". 2.4.0's promise that the command "refuses to write a half-finished sweep" only held for some truncations; it holds for all of them now.
- **Fixed: a host answering HTML or an empty body threw** instead of returning a result, so `comfy-ts loras` died with `Failed to parse JSON` and the TUI preview showed a generic error. A ComfyUI reverse proxy serving its SPA fallback on an unknown route hits this.
- **Fixed: any error status on the first page was reported as "the extension is not installed".** A 500 (lora-manager rescanning its model database) or a 403 sent you off to reinstall a working extension. Only 404/405 mean absent now; anything else says unreachable and names the status.
- **Lora metadata follows the host a run will actually target.** After overriding the run host with `h` in the TUI, the overlay showed the defining host's model names and injected its trigger words. Both now come from the host the generation goes to.
- **A mirror synced while the TUI is open is picked up.** Opening the loras overlay re-reads any mirror whose file changed, so `comfy-ts loras` in another terminal no longer needs a restart to take effect.
- A failed sweep no longer leaves an empty `.comfy-ts/hosts/<id>/` behind when you typo `--id`, and a genuinely new host id is no longer refused just because other host folders exist.
- An unparseable mirror no longer silently falls back to another host's lora metadata.

## 2.4.1

- **An unreachable host now answers immediately instead of waiting out the connect deadline.** A refused TCP connection means nothing is listening, so retrying it cannot help: the websocket client reports a close that never opened instead of spending the 2s retry loop, and `connect()` rejects at once with `ComfyHostUnreachableError`. `comfy-ts serve` returns its 502 in milliseconds, so a dead host no longer costs every queued request 30 seconds each. A server that ACCEPTS but never speaks (a busy single threaded ComfyUI) is a different case and still gets the full `timeoutMs` deadline. Reconnects after a successful connect are untouched and still retry forever.

## 2.4.0

Your loras stop being opaque file names.

- **New command `comfy-ts loras`**: mirrors everything the optional [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager) extension knows about your loras into `.comfy-ts/hosts/<id>/loras.json` — the real model name, civitai trigger words, tags, base model, preview url, and every other field it returns, stored raw. One paged sweep, no per-file requests. `--id` defaults to the only host folder on disk, `--host` to the url the last sync used, so refreshing later is just `comfy-ts loras`. No extension on that host = a loud error and an untouched mirror.
- **Trigger words become prompt keywords by themselves.** With `v.prompt(text, { loraKeywordsFrom: lorasVar })`, an active lora that has civitai trigger words now prefixes them onto the built prompt with nothing typed by hand. A keyword you assign yourself (⌃K in the TUI loras overlay) still wins, and setting it to empty on such a lora means "inject nothing" rather than falling back to the trigger words.
- **The TUI loras overlay finds a lora by its human name.** The filter matches the model name, tags, base model and trigger words, not only the file name: every word you type must appear in one of them, in any order, so `aurora ink` and `styles wash` both land on `styles\aurora-ink-v3.safetensors`. Rows show the model name next to the file name, and lora previews come from the local mirror instead of a request.
- **⌃D in the loras overlay resets a keyword** to whatever lora-manager says, undoing a hand-typed one. Rows show a mirror-sourced keyword dim and a hand-typed one in yellow, so you can always tell which is which.
- `comfy-ts loras` **refuses to write a half-finished sweep.** If the host stops answering partway through the list, the existing mirror is left alone and the command exits non-zero, rather than silently dropping every lora past the break.
- Lora metadata is kept **per host**. Two hosts with the same lora file name no longer share one entry, so a host can never show the other's model name or inject the other's trigger words.
- New exports for building your own surface over the same data: `getLoraInfo`, `getLoraTriggerWords`, `getLoraDisplayName`, `getLoraPreviewUrl`, `loraSearchNames`, `loraSearchText`, `loraMatchesFilter`, `isLoraKeywordFromMirror`, `loraKeywordFromMirror`, `clearLoraKeywordOverride`, `reloadLoraInfoCache`, `loraKey`, and the `LoraMirror`, `LmLoraItem` and `LoraSweep` types. Every getter takes an optional host id.
- With no extension installed, or before you ever run `comfy-ts loras`, every one of these surfaces behaves exactly as it did in 2.3.0.

## 2.3.0

- **Fixed: an unreachable host hung forever instead of erroring.** `connect()` waited on a websocket that retries every 2 seconds, and a refused TCP connection is a close rather than a dead transport, so the promise never settled: scripts hung with no message, and `comfy-ts serve` never answered `POST /generate` and then queued every later request for that workflow behind the hung one. The first connect now has a deadline, `ComfyTS.host(...).connect({ timeoutMs })`, default 30s (`0` or `Infinity` waits forever, the old behaviour). Reconnects after a successful connect are untouched and still retry forever.
- A failed connect is retryable again. The rejected promise used to stay cached on the host, so once a connect failed, every later `connect()` replayed the same stale error and a host that came back stayed unreachable for the life of the process.
- New export `ComfyHostUnreachableError` (match it by `e.name`). `comfy-ts serve` answers **502** with the host id and websocket url when the host never comes up, instead of a 500 or nothing at all.

## 2.2.0

The repair release. `comfy-ts serve` was broken for every payload override in every version since 1.3.0; this fixes it and the three quieter faults that shipped with it.

### Serve, fixed

- **Fixed: `comfy-ts serve` rejected every payload override.** `POST /generate` answered `var '<name>' has unsupported kind '<kind>'` for every var, and `GET /drafts` described every var as `"payload": "string"`. The cause was `instanceof`: the package defines the var classes once in `dist/index.js` (what your `.cflow.ts` imports) and again in the cli bundle (what `comfy-ts serve` runs), so the check was always false. Discrimination is by `kind` now, which crosses that boundary. Broken since 1.3.0, when serve landed.
- **`v.prompt` vars report `kind: "prompt"`** (they used to report `"text"`, indistinguishable from `v.text`). `GET /drafts` now states the real prompt contract, and `VarKind` gains the `'prompt'` member. If you switch exhaustively on `VarKind`, add the case; a prompt var previously arrived labelled `'text'`.
- **Serve seed modes work again.** `?` never rerolled and `+`/`-` never advanced, so every `POST /generate` that omitted the seed silently reused the draft's stored value. If you worked around identical outputs by always sending an explicit seed, you can stop.
- **Serve image vars accept an http(s) url again**, and the "file not found" preflight runs again. A url used to be stored verbatim as a path, and a missing file surfaced later as a build crash instead of a 400.
- The same `instanceof` fault silently disabled prompt colouring (`//` comments, `- ` negative lines) in the packaged TUI. Fixed with it.
### Library

- **Re-encoded saves get one honest extension**: `save: { format: 'image/webp' }` now writes `shot_20260731-154210_00001.webp`. It used to append the new extension after the server's original one (`…_00001.png.webp`), which named the bytes twice and got the first name wrong.
- **`host.latentPreview.url` is revoked when the next frame replaces it.** Every preview frame used to leak its blob into the object-url registry for the life of the process (one frame per sampler step). If you hold on to a url across frames, read the bytes or re-create the url from `latentPreview.blob`; `onLatentPreview` hands you the raw bytes and is unaffected.

## 2.1.0

The TUI catches up with ephemeral outputs: saving is a visible choice, and memory-only runs are fully usable.

- **Save toggle in the vars panel**: a TUI-owned `save to disk` row sits under your workflow vars (⏎ toggles, persisted in `.comfy-ts/settings.json`, default on). Off = outputs stay in memory.
- **Editable save prefix**: while saving is on, a `save prefix` row follows — the directory appended after `.comfy-ts/outputs/`, editable in place (⏎), persisted per workflow, slashes nest subfolders, empty resets to the workflow's name.
- **Memory outputs are first-class**: the outputs box lists them as `filename (WxH, in memory)`, the preview panel renders them from the buffer, latents unchanged.
- **`i` copies without touching disk**: the image is normalized to png in memory and piped to the platform clipboard tool over stdin (macOS osascript `«data PNGf»` script on stdin, Windows base64 → MemoryStream, Linux xclip). A tmp file is written only if the piped tool fails, and the popup says which route ran. `o` (open in OS viewer) still writes one tmp file — a viewer opens a path.

## 2.0.0

The ephemeral release: images that never persist — not on the ComfyUI server, and (unless you ask) not on your disk either. The README's "Ephemeral outputs" section has the full story, including the saver × save matrix and the honest limits.

**Breaking**

- `RunSettings.saveFormat` is now `save`, and the `ImageSaveFormat` type is now `SaveOptions` (`format` optional, `'raw'` default; `save: true` is raw with default naming).
- Local disk saving is OPT-IN. `run()` without `save` keeps outputs as in-memory `MediaImage`s: `absPath` is `null` (its type widened to `AbsolutePath | null`), the bytes live in `img.buffer` / `img.getAsBlob()` / `img.getBase64Url()`, `filename` derives from the content hash. To get 1.x behavior back, pass `save: true` (or `save: { prefix: 'my-dir' }` to group outputs in a subfolder).
- The TUI and `comfy-ts serve` still save to disk (they opt in themselves, grouped per module under `.comfy-ts/outputs/`).

### Ephemeral outputs

- `SaveImageWebsocket` is a first-class output node: its images stream back as binary websocket frames straight into `execution.images`, and the server disk is never touched. The node ships with every ComfyUI install. Frames that arrive before the `POST /prompt` response are buffered in order and replayed, so no output can be lost to that race.
- `run({ ephemeral: true })` rewrites every `SaveImage` node to `SaveImageWebsocket` in the SENT prompt only — your graph stays exactly as authored — and implies `scrubHistory`.
- `run({ scrubHistory: true })` deletes the run's server-side history entry (the full workflow JSON, prompts included) after completion; failures log loudly but never fail the run. `host.deleteHistory(promptId)` and `host.clearHistory()` are the standalone calls.
- The inputs gap, stated: uploaded images persist in the server's `input/` folder (ComfyUI has no delete API); ephemeral runs referencing `LoadImage` warn once. `MediaImage.loadInWorkflow_viaBase64Node(wf)` inlines the image into the prompt instead when the host has `ETN_LoadImageBase64` (comfyui-tooling-nodes) or Easy-Use's `easy loadImageBase64`. Comfy Cloud currently ships neither.
- Video/audio savers (`SaveVideo`, `SaveAudio*`) have no websocket variant upstream; those outputs persist on the host.

### Codegen

- `SaveImageWebsocket` gets its core, unqualified key: `b.SaveImageWebsocket` (was `b['websocket_image_save.SaveImageWebsocket']`) — the node lives inside the ComfyUI repo itself.
- Cloud catalog refreshed: 48 new node types.

### Examples

- Every image example (the whole cloud zoo, the numbered rvion sequence, the browser page) saves via `SaveImageWebsocket` and leaves nothing on the server; standalone runs opt into local saving under `comfy-ts-zoo/<name>` / `comfy-ts-example/<id>`. Video/audio examples state that their outputs stay on the host.

## 1.4.0

The browser release: `import { ComfyTS } from 'comfy-ts/web'` runs the library in a browser bundle — define workflows, connect to a host over the native WebSocket, run, get bytes back, nothing touching disk.

**Removed** (stated loud): `MediaImage.generatePreview` and `MediaImage.generateMiniPreview` are gone. Both were undocumented convenience wrappers; `processWithSharp` covers them in one call (`img.processWithSharp((s) => s.resize(100).jpeg())`). Also gone: `ResilientWebSocketClient.addEventListener`/`removeEventListener` (never called; the `on*` options cover the surface), and `onWsMessageAny` now receives a structural `{ data: unknown }` event instead of the `ws` package's `MessageEvent` type.

### `comfy-ts/web`

- New package export, ESM only. Same API surface as the node entry minus the node-only bits (`exampleImagePath`, `isTuiActive`). Types work unchanged: include a generated `sdk.d.ts` in your tsconfig.
- Storage is a pluggable seam: node gets the real filesystem (unchanged behavior), the web entry an in-memory store, and `ComfyTS.create({ storage })` accepts your own backend (`ComfyStorage`: 9 sync methods + `homedir`/`cwd`).
- Browser websocket auth: an `apiKey` rides the upgrade as `?token=…` (browsers cannot set upgrade headers; Comfy Cloud accepts the query form). Custom `headers` pairs on a browser transport throw loud instead of silently dropping auth.
- Support matrix, honestly: local/LAN hosts connect directly when ComfyUI runs with `--enable-cors-header '*'`. Comfy Cloud sends no CORS headers today, so cloud from a browser goes through `comfy-ts serve`.
- Runnable browser example under `examples/web/` (`bun examples/web/serve.ts`).

### Library

- `MediaImage.metadata` and `.hash` reuse the already-loaded buffer instead of re-reading the file; `processWithSharp`/`processWithSharp_inplace` load sharp lazily and throw a clear error in browsers.
- Hashing (upload dedupe, enum names, preview cache keys) moved to a pure-JS sha1 with output identical to node's — existing hash-named uploads and caches stay valid.
- Re-encoded outputs (`saveFormat` other than `'raw'`) keep working on node and error loudly where sharp is unavailable.
- `downloadFile` uses fetch instead of node:https.

## 1.3.0

The serve release: every draft you tune in the TUI becomes a local HTTP generation API, outputs stop overwriting each other, and workflow JSON import reaches 100% compatibility with the official template corpus.

### Serve

- New command: `comfy-ts serve [dir | module]` exposes every draft of your `*.cflow.ts` workflows over HTTP (default `127.0.0.1:8288`). `POST /generate/<module>/<draft>` — or `/generate/<draft>` when only one module has it — runs the workflow: the draft's stored values are the defaults, the JSON body overrides them per request, and every value is validated before anything queues (a wrong value gets a 400 listing the allowed ones).
- `GET /drafts` describes every workflow, draft and var (kind, allowed values, ranges, defaults) as JSON — enough for a frontend to render a form. `GET /drafts/<module>/<draft>` adds that draft's stored values. Draft files are re-read on every request, so TUI tweaks apply live; serve never writes them.
- Responses block until the run finishes and return output urls served under `GET /outputs/…`; `Accept: image/*` returns the first image's bytes directly. Seed policy per draft: an explicit payload seed is fixed for that request, mode `?` rerolls every request, `+`/`-` continue from the last served value.
- Image vars accept a local path or an http(s) url (downloaded before the run). CORS is open and OPTIONS preflight is answered, so browser pages can call the API directly. Binding beyond loopback (`--bind`) prints a loud no-auth warning.

### Outputs

- Downloaded outputs are named locally instead of trusting the server filename: `stem_YYYYMMDD-HHmmss_counter.ext`. Hosts with ephemeral output dirs (Comfy Cloud) reset their server-side counter and used to overwrite the same file every run — nothing overwrites anymore, two runs in the same second included.
- A `filename_prefix` ending in `/` is a directory (it used to leak into the filename); otherwise its last segment becomes the name stem. `saveFormat.prefix` stays the explicit local override and keeps the workflow stem.

### TUI

- `i` copies the last generated image's pixels to the clipboard (macOS, Linux/xclip, Windows), confirmed by the same popup as `c`/`C`. Formats the OS clipboard cannot tag are transcoded to png first, so a webp output pastes correctly instead of silently corrupt.
- Small terminals: the frame is fixed-height, and both the tree and the vars panel window their rows with scroll markers. Non-selected var rows compact to one line while the list overflows, so the selected var can never leave the screen.

### Import / export

- Template compatibility reaches 100%: all 762 official Comfy-Org templates import structurally clean. Widgets whose real value hides behind frontend-injected button slots (Load3D family) are read and written at the right offset in both directions.
- `control_after_generate` phantom values are config-driven on export as they already were on import, so export and import can no longer disagree about a widget's run length.

### Library

- `SeedVar.reset()` restores the mode to `=` along with the value — a caller's `?`/`+` mode no longer survives a reset.
- Every var exposes `defaultValue` and `reset()` on the `AnyVar` face.

## 1.2.0

The navigation release: the TUI workflow list becomes a real tree with filtering and colors, any workflow can run on any host, and copying always tells you what happened.

### TUI

- The workflow list is a real tree: directories fold and unfold, single-child chains merge into `a/b` rows, and `/` filters as you type (esc clears, ⏎ loads). Workflows are colored by model family over a stable palette; a workflow can pin its own color via `color` in its spec. Fold state persists across restarts.
- `h` opens a host picker to override the RUN host of the loaded workflow — any registered host, or back to the workflow default. The override persists, and the header shows a yellow `⇄ overrides <id>` marker while active. `a` keeps the actions panel.
- `c` / `C` copy now always ends in a confirmation popup: green with what was copied (node count, size, a head of the json as proof), red with the exact build or clipboard error. A `building for copy…` notice covers slow builds (image-to-image workflows upload their input image at build time).
- The host status dot stops lying: a busy ComfyUI stalls NEW connections while it generates, so a probe timeout alone no longer paints the dot red — recent websocket traffic counts as proof of life, and a down dot now says WHY (timeout, dns, http status) in the host stats.
- No-arg `comfy-ts tui` reopens the last loaded workflow.
- The image picker lists dot-named directories (`.comfy-ts/outputs`, …); dot files stay hidden.
- Startup no longer shows a literal `^[[?0u` prefix on the first frame.

### Library

- `DefinedWorkflow.build()` / `.run()` accept `{ host }` to execute on a different registered host than the one the workflow module declared.
- `v.size(default, { image })` links a size var to an image var: the TUI size overlay offers a pickable `WxH  size of image '<name>'` row reading the image's actual dimensions.
- Auto-layout spreads nodes wider (horizontal gap 20 → 100, vertical 20 → 40), so workflows exported with `toWorkflowJson()` or copied from the TUI paste readable in the ComfyUI editor. `node_hsep` / `node_vsep` overrides unchanged.
- `npm fund comfy-ts` now points at the project's sponsor page.

### Examples

- Hand-written examples move to `examples/rvion/` (the cloud zoo stays in `examples/comfy-cloud/`); new `06-qwen-image-edit` mirrors the official qwen image edit 2511 template, with a toggle for the 4-step lightning lora.

## 1.1.0

The model zoo release: 46 ready-to-run cloud workflows, a real image picker in the TUI, and a registry mirror that doubled.

### The example zoo

- `examples/comfy-cloud/`: 45 new workflow modules transcribed from the official ComfyUI templates, named `<family>-<mode>` across 32 model families: t2i (sdxl, sd3.5, flux1, flux2, qwen-image, z-image, chroma, hidream, omnigen2, kandinsky5, krea2, and more), i2i edits, t2v and i2v video (wan 2.1/2.2, ltxv, hunyuan video 1.5, svd, kandinsky5), t2a audio (ace-step, stable-audio, chatterbox). Every file typechecks against the committed Comfy Cloud catalog SDK and builds a problems-free graph offline; each header names its source template and run command.
- `examples/README.md` + a shared `cloudHost.ts` helper: one host setup, one pattern. Keyless machines can still open everything in the TUI; standalone runs ask for `COMFY_CLOUD_API_KEY` with a clear message.
- Video/audio examples print where the result landed host-side (their outputs are not downloadable images yet).

### `v.image` + the TUI image picker

- New var kind `v.image(path, { folder?, extensions? })`: a plain path string (hand-editable in drafts), `~` expansion, typed loud error when a build needs an image and none is set.
- The TUI opens a full image picker on image vars: browse the disk, filter as you type, favorite folders, recent picks, live preview of the highlighted image in the preview panel. Favorites/recents/last folder persist to a human-editable `.comfy-ts/image-picker.json`.
- `examples/images/`: six bundled sample images (picsum.photos, Unsplash sourced, free to use) with exact sizes in the filename (`bear_1024x1024.jpg`…); `exampleImagePath('dog_512x512.jpg')` resolves them from the installed package, so every i2i example runs out of the box.

### Ecosystem registry, doubled

- The ComfyUI-Manager mirror moved to the canonical Comfy-Org sources and regenerated: 5882 plugins (was 2569), 41204 known custom node names (was 19278), 540 models. Every registry row is validated individually; a parse report (accepted / skipped with causes) prints at every regeneration.
- New npm keywords + description; the README gained hosts, codegen, and examples sections reflecting all of the above.

## 1.0.0

The 1.0: every Comfy is supported (local, LAN, Comfy Cloud, any provider), the official template corpus imports at 99.5%, and the TUI works out of the box with zero arguments.

### Cloud and remote hosts

- New host config spelling: `comfy.host({ id, url })` takes a full base url as pasted from a provider (`https://cloud.comfy.org`, `https://xxx.modal.run`, base paths supported). The legacy `{ host, port, https? }` spelling is unchanged; use exactly one of the two.
- `apiKey` rides `X-API-Key` on every request AND the websocket upgrade; `headers` merges extra auth pairs (Modal style). Auth failures are typed: invalid key (401), insufficient credits (402), subscription inactive (429).
- Routes prefer the `/api/*` spelling with automatic fallback for older local servers; output downloads follow Comfy Cloud's signed-url redirect without leaking the key cross-origin.
- Binary websocket preview frames of type 3 and 4 (image + metadata, the Comfy Cloud spelling) now feed latent previews; unknown frame types log once instead of throwing.
- `comfy-ts gen` gained `--api-key` (or `COMFY_CLOUD_API_KEY`) and `--out`. The full Comfy Cloud catalog ships in the repo as a browsable generated SDK (`examples/comfy-cloud/sdk.d.ts`, 3574 nodes) with a runnable [example](examples/rvion/05-comfy-cloud.cflow.ts).

### workflow.json import, rebuilt

- One entry point: `parseWorkflowJson(unknown)` validates with tolerant schemas that model what ComfyUI actually serializes today (v0.4 tuple links AND v1 object links, hybrid files), then normalizes into one strict canonical form. Genuinely invalid input throws a typed `WorkflowNormalizeError`; conversion failures throw `WorkflowConvertError` with a code naming the feature.
- Subgraphs: `definitions.subgraphs` instances are expanded (nested subgraphs, widget promotion in both serializer eras, boundary io by name).
- Execution semantics fixed: Note/MarkdownNote/Reroute/PrimitiveNode are skipped as virtual, bypass (mode 4) rewires inputs through to outputs the way the frontend does (previously executed as a normal node), muted parents resolve unconnected, object-form `widgets_values` resolve by name.
- 2026 widget spellings understood: widget-ness is decided from the input CONFIG (COMBO options, dynamic combos, autogrow containers, socketless widgets), and positional value arrays shorter than the current schema fill from schema defaults.
- Measured on the full official template corpus (762 workflow files from Comfy-Org): 100% schema-pass, 99.5% convert structurally.
- `host.importWorkflowJson` now takes `unknown` and validates.

### TUI

- `bunx comfy-ts tui` with no argument never opens empty: it scans your project's `*.cflow.ts` (node_modules excluded) AND the examples bundled with the package, grouped apart in the tree. An explicit dir or file argument scans just that.
- A module that fails to load shows as a red ✗ row (retry with ⏎) instead of crashing the TUI; a missing schema cache degrades to base types with a loud message instead of throwing at import.

### Packaging

- The npm tarball now ships `examples/` and `guide-for-agents.md`. Add `@./node_modules/comfy-ts/guide-for-agents.md` to your `CLAUDE.md` and your coding agent knows the whole library.

### Breaking

- `convertLiteGraphToPrompt` consumes the new canonical form; import errors are typed (`WorkflowNormalizeError` / `WorkflowConvertError`) instead of ad-hoc throws, and the former `UnknownCustomNode` error class folded into the `unknown-node` error code.
- `host.loadSchemaFromCache()` with no cache on disk no longer throws: it logs and continues on permissive base types (call `connect()` or run `gen` to sharpen).

## 0.4.0

Everything user-facing that landed since 0.3.0. No breaking changes.

### Host awareness in the TUI

- The `(h)ost` header box carries a LIVE reachability dot: green when the host answers, red when it doesn't, gray while unknown. The truth comes from an HTTP probe every 5s, so a dead host turns red even when a half-open websocket still claims to be connected. While down, the box shows the probe loop working: a spinner during the attempt, then a `↻ Ns` countdown to the next one.
- New `comfy host logs` panel below the run area: the ComfyUI server console streams into the TUI (backfill + live follow, ANSI stripped, progress-bar redraws collapsed to their latest state, error lines red). If the server sends no latent previews mid-run, the preview panel says so and names the fix (`--preview-method auto`).

### Preview settings menu

- `p` no longer blind-cycles: it opens a settings menu inside the preview panel. Three independent, persisted settings: `panel` on/off, `renderer` native (real images) / pixel (half-blocks), and `while running` latent / latent small / last output. `latent small` keeps the last output as the big image with the live latent in the top-right corner; `last output` ignores latent frames entirely. ←→ change values, ⏎/p/esc close.
- Native rendering is now flicker-free (repaints are synchronized with the frame that damaged them, DEC 2026) and the terminal is restored clean on quit (no leftover image, no stray colors).

### Library

- `ComfyHost.onSession(sid)` fires on every websocket session assignment (first connect AND reconnects) — the hook for per-session server state.
- `ComfyHost.onLogs` + `subscribeLogs({ enabled, clientId })` + `fetchRawLogs()` expose ComfyUI's `/internal/logs` console stream; the `logs` websocket message type is part of the typed `WsMsg` union.

## 0.3.0

Everything user-facing that landed since 0.2.0. Breaking changes are marked 💥.

### The re-run contract: `defineWorkflow` + vars

- `host.defineWorkflow({ id, vars, build })` declares the knobs once; `build` re-executes against the current values on every `run()`, producing a fresh graph each time. Var kinds: `v.text` `v.int` `v.float` `v.seed` `v.toggle` `v.choice` `v.size` `v.loras` `v.prompt`.
- `vars` may be a LAMBDA receiving `v`: `vars: (v) => ({ loras: v.loras(/krea/i), … })` so cross-referencing vars share one scope, with the host's generated types injected (no import, no user-side cast).
- `v.loras` accepts a RegExp directly (resolved against the host's real lora list at define time) or any dynamic list such as `host.schema.getLoras(/xl/i)`. `activeLoras(vars.loras)` normalizes to `{ lora_name, strength_model, strength_clip }[]` for a standard `LoraLoader` chain.
- `v.prompt` yields a structured `{ positive, negative }` at build time: `//` lines are comments, `- ` lines are negative prompt lines, and with `{ loraKeywordsFrom: lorasVar }` the active loras' trigger words prefix the positive prompt.
- `v.seed` is a MODE plus a number (`+ N` increment, `- N` decrement, `= N` fixed, `? N` reroll), advanced after every run, so a queued batch gets distinct seeds.

### Execution

- `workflow.run({ log, onProgress })` reports live progress; `run({ log: true })` renders a single updating console line. `execution.done` resolves on success AND failure (inspect `status`), and `execution.images` are `MediaImage`s on disk.
- `start()` freezes an `ExecutionSnapshot` (api json + workflow json) at send time, so the live workflow stays editable while a run is in flight.
- Failed image retrievals land in `execution.imageErrors` instead of hanging `done`.

### The TUI (`bunx comfy-ts tui`)

- Keyboard-first three-panel terminal UI over every `*.cflow.ts` in a folder: workflow tree with drafts nested under each workflow, vars panel, preview.
- Drafts: named var-value snapshots per workflow, always-in-a-draft, debounced autosave, full CRUD; the last active draft per workflow is remembered.
- Preview panel: live latent previews while a run is in flight, then the final output. `p` cycles native → ansi → off; on iTerm2 / WezTerm / VS Code terminals "native" paints the REAL image, elsewhere truecolor half-blocks.
- `r` during a run queues another prompt on the server; progress, previews and outputs follow every queued run, not just the first.
- Multiline prompt editor with readline word ops, line-wise motion, `// ` comment toggling, `- ` negative lines, and the injected lora keywords shown as non-editable chrome.
- Host panel: node/lora/embedding counts, live server queue length, re-codegen the SDK, restart ComfyUI, clear the pending queue, interrupt the current run.

### Imports, exports, ecosystem

- `toApiJson()` / `toWorkflowJson()` (autolayouted litegraph JSON, drag it into the ComfyUI editor) and the reverse `host.importApiJson()` / `host.importWorkflowJson()`.
- ComfyUI-Manager registry mirror: install custom nodes and models, plus generated `Known*` unions over the whole ecosystem.
- ComfyUI-Lora-Manager support: lora preview images in the TUI when the extension is present, quietly skipped when it is not.

### 💥 Breaking

- The great renaming, pre-1.0: `ComfyPrompt` → `ComfyExecution`, `sendPrompt`/`sendPromptAndWaitUntilDone` → `start()`/`run()`, `prompt.finished` → `execution.done`, `json_forPrompt()`/`json_workflow()` → `toApiJson()`/`toWorkflowJson()`, `CONNECT()`/`DISCONNECT()` → `connect()`/`disconnect()`, `createEmptyWorkflow()` → `workflow()`, `MediaImageL` → `MediaImage`, `nameInCushy` → `nodeKey`, `src/livegraph/` → `src/graph/`.
- `ComfyUIObjectInfoParsed` and `ComfySchema` merged into one `ComfySchema`.

### Under the hood

- Dual ESM/CJS build via tsdown (TypeScript 7 / tsgo emits the dts), oxlint + oxfmt, bun test.
- The library typechecks with NO generated sdk on disk, which is what a fresh clone and CI see.

## 0.2.0

### Minor Changes

- setup repo
