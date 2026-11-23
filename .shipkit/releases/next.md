---
"Paid partner API nodes run with your Comfy account key": commit 05639aa, weight feature
---
# next (minor)

## Workflows

### Paid partner API nodes run with your Comfy account key
ComfyUI's partner nodes (Kling, MiniMax, Flux Pro and the other `api_node` nodes) call a paid service billed to a Comfy account, and need the account key in each prompt. Give it once on the host with `comfy.host({ id, comfyOrgApiKey })`, or for one run with `run({ comfyOrgApiKey })`; it is a string, or a function read only when such a run starts, so a key can come from a secret store at that moment. It is sent only with a prompt that holds a partner node, and it never goes into the workflow saved in output files, the execution snapshot, an error or a log. A prompt with a partner node and no key now fails before anything is sent, with a `ComfyOrgApiKeyMissingError` that names the node and how to set the key, so nothing is queued or billed by surprise. On Comfy Cloud, the host's `apiKey` is used when no account key is set.
