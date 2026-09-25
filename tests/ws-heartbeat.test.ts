// a host that vanishes mid session (power loss, hard reboot) never sends a close frame: the socket
// stays "open" forever, and every run after it waits for events that never come
import { describe, expect, it } from 'bun:test'
import { ResilientWebSocketClient, type WsLike } from 'src/host/ResilientWebsocket.ts'

/** a fake `ws` socket: opens at once, answers pings only while `alive` */
function fakeTransport(p: { answersPings: boolean }): {
   transport: { ctor: new (url: string) => WsLike; supportsHeaders: boolean }
   created: FakeWs[]
} {
   const created: FakeWs[] = []
   class Ctor extends FakeWs {
      constructor(url: string) {
         super(url, p.answersPings)
         created.push(this)
      }
   }
   return { transport: { ctor: Ctor, supportsHeaders: true }, created }
}

class FakeWs implements WsLike {
   binaryType = 'arraybuffer'
   onmessage: WsLike['onmessage'] = null
   onopen: WsLike['onopen'] = null
   onclose: WsLike['onclose'] = null
   onerror: WsLike['onerror'] = null
   terminated = false
   private pongListeners: (() => void)[] = []
   constructor(
      public url: string,
      private answersPings: boolean,
   ) {
      setTimeout(() => this.onopen?.({}), 1)
   }
   send(): void {}
   close(): void {}
   on(event: string, cb: () => void): void {
      if (event === 'pong') this.pongListeners.push(cb)
   }
   ping(): void {
      if (this.answersPings) setTimeout(() => this.pongListeners.forEach((cb) => cb()), 1)
   }
   terminate(): void {
      this.terminated = true
      setTimeout(() => this.onclose?.({ code: 1006, reason: '' }), 1)
   }
}

const client = (transport: { ctor: new (url: string) => WsLike; supportsHeaders: boolean }): ResilientWebSocketClient =>
   new ResilientWebSocketClient({
      url: () => 'ws://box/ws',
      onMessage: () => {},
      onConnectOrReconnect: () => {},
      onClose: () => {},
      transport,
      heartbeatMs: 20,
      reconnectMs: 5,
   })

describe('websocket heartbeat', () => {
   // why we think it is actually a bug, and not just meaning spec should change: after the box
   // rebooted, the panel server kept its dead socket forever and every run hung until the process
   // was restarted by hand; the reconnect loop only runs on a close that never came
   it('a socket that stops answering pings is dropped and a new one opens', async () => {
      const f = fakeTransport({ answersPings: false })
      const c = client(f.transport)
      await Bun.sleep(120)
      c.disconnectPermanently()
      expect(f.created[0]?.terminated).toBe(true)
      expect(f.created.length).toBeGreaterThan(1)
   })

   it('control: a socket that answers pings is kept', async () => {
      const f = fakeTransport({ answersPings: true })
      const c = client(f.transport)
      await Bun.sleep(120)
      c.disconnectPermanently()
      expect(f.created.length).toBe(1)
      expect(f.created[0]?.terminated).toBe(false)
   })
})
