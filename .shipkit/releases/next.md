---
"A run survives a dropped connection": commit 78146f4, weight improvement
---
# next (patch)

## Workflows

### A run survives a dropped connection
A run whose websocket dropped and reconnected while ComfyUI worked could wait forever with no error: ComfyUI sent the rest of its events to the old connection, and after some reconnects the connection stayed open but received nothing. The reconnect now keeps the same session, and a run that hears nothing for a moment asks the server where it stands, less and less often while it stays quiet: a run that ended without its events reaching the client finishes from the server history with its outputs, a run still in the queue keeps going, and a run the server no longer knows (it restarted) fails with the reason in `execution.data.reason`. A connection found deaf this way reconnects by itself. `host.runSilenceMs` (1 s) and `host.runSilenceMaxMs` (30 s) set when it asks.
