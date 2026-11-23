---
"A run survives a dropped connection": commit eb88fe6, weight improvement
---
# next (patch)

## Workflows

### A run survives a dropped connection
A run whose websocket dropped and reconnected while ComfyUI worked could wait forever with no error: ComfyUI sent the rest of its events to the old connection. The reconnect now keeps the same session, and each run in flight then asks the server where it stands: a run that ended while the connection was down finishes from the server history with its outputs, a run still in the queue keeps going, and a run the server no longer knows (it restarted) fails with an error instead of waiting.
