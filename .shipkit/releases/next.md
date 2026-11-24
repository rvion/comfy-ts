---
"Paid partner API nodes run with your Comfy account key": commit 05639aa, weight feature
"Video, sound and 3D outputs carry the tag of the node that saved them": commit b8eecba, weight improvement
"A large image sent over the websocket always arrives": commit 7c0fc91, weight improvement
---
# next (minor)

## Workflows

### Paid partner API nodes run with your Comfy account key
ComfyUI's partner nodes (Kling, MiniMax, Flux Pro and the other `api_node` nodes) call a paid service billed to a Comfy account, and need the account key in each prompt. Give it once on the host with `comfy.host({ id, comfyOrgApiKey })`, or for one run with `run({ comfyOrgApiKey })`; it is a string, or a function read only when such a run starts, so a key can come from a secret store at that moment. It is sent only with a prompt that holds a partner node, and it never goes into the workflow saved in output files, the execution snapshot, an error or a log. A prompt with a partner node and no key now fails before anything is sent, with a `ComfyOrgApiKeyMissingError` that names the node and how to set the key, so nothing is queued or billed by surprise. On Comfy Cloud, the host's `apiKey` is used when no account key is set.

### Video, sound and 3D outputs carry the tag of the node that saved them
An image output already carried the `tag` of the node that saved it. Videos, sounds and 3D files now carry it too, so a graph with two SaveVideo or two SaveGLB nodes tells its outputs apart in `execution.videos`, `execution.audios` and `execution.models3d`.

## Fixes

### A large image sent over the websocket always arrives
A run that saves through SaveImageWebsocket could end with « success, no image » when the image was large (16 MB and more over a slow link): the run watchdog took the wait for the frame still in transit as a silent socket and finished the run without it. Such a run now waits for its frames up to `host.runSilenceMaxMs` (30 s) before it checks the queue, so the image comes back.
