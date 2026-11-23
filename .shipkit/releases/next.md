---
"A run survives a dropped connection": commit 1f3b262, weight improvement
---
# next (patch)

## Workflows

### A run survives a dropped connection
A run whose websocket dropped and reconnected while ComfyUI worked could wait forever with no error: ComfyUI sent the rest of its events to the old connection, and after some reconnects the connection stayed open but received nothing. The reconnect now keeps the same session. When the whole connection has heard nothing for a moment, the runs that heard nothing either ask the server where they stand, less and less often while it stays quiet: a run that ended without its events reaching the client finishes from the server history with its outputs, a run still in the queue keeps going, and a run the server no longer knows (it was cancelled, or the server restarted) fails with the reason in `execution.data.reason`. A connection found deaf this way reconnects by itself. A healthy run costs no extra request, and a server whose queue or history is not shaped like ComfyUI's (Comfy Cloud) is left alone. `host.runSilenceMs` (1 s) and `host.runSilenceMaxMs` (30 s) set when it asks.
