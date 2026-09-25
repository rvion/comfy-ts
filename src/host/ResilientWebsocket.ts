// transport-agnostic since 2026-07-31 (architecture item 13): node uses the
// `ws` package (custom upgrade headers work), browsers the native WebSocket.
// The `ws` import specifier is a VARIABLE so browser bundlers never chase it.
import type { Maybe } from 'src/types/index.ts'
import { bang } from 'src/utils/bang.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { logInfo } from 'src/utils/log.ts'

type Message = string | Uint8Array

/** structural face of both transports (ws package AND browser WebSocket) */
export type WsLike = {
   binaryType: string
   onmessage: ((event: WsMessageEvent) => void) | null
   onopen: ((event: unknown) => void) | null
   onclose: ((event: WsCloseEvent) => void) | null
   onerror: ((event: unknown) => void) | null
   send(data: Message): void
   close(): void
   /** the `ws` package only (a browser answers pings by itself and exposes none of these) */
   ping?(): void
   on?(event: 'pong', cb: () => void): void
   terminate?(): void
}

/** what both transports deliver with binaryType 'arraybuffer': string or ArrayBuffer in `data` */
export type WsMessageEvent = { data: unknown }
export type WsCloseEvent = { code: number; reason: string }

type WsCtor = new (url: string, opts?: { headers?: Record<string, string> }) => WsLike

export type WsTransport = { ctor: WsCtor; supportsHeaders: boolean }

let transportPromise: Promise<WsTransport> | null = null

/** node: the ws package (headers on the upgrade). browser: native WebSocket. */
function resolveWsTransport(): Promise<WsTransport> {
   transportPromise ??= (async (): Promise<WsTransport> => {
      const specifier = 'ws'
      try {
         // cast: the ws package ctor fits WsCtor structurally; a variable
         // specifier types the import as any, so the shape is stated here
         const mod = (await import(specifier)) as { default: WsCtor }
         return { ctor: mod.default, supportsHeaders: true }
      } catch {
         const native = (globalThis as { WebSocket?: WsCtor }).WebSocket
         if (native != null) return { ctor: native, supportsHeaders: false }
         throw new Error(`no WebSocket transport: neither the 'ws' package nor a global WebSocket is available`)
      }
   })()
   return transportPromise
}

type WsDebugMessage = {
   type: 'info' | 'error'
   timestamp: number
   message: string
}

export class ResilientWebSocketClient {
   private url: string
   private currentWS?: Maybe<WsLike>
   private messageBuffer: Message[] = []

   isOpen: boolean = false
   debugMessages: WsDebugMessage[] = []

   private addInfo(msg: string): void {
      this.debugMessages.push({ type: 'info', timestamp: Date.now(), message: msg })
      logInfo(`[🧦] WS: ${msg}`)
   }

   private addError(err: string): void {
      this.debugMessages.push({ type: 'error', timestamp: Date.now(), message: err })
      console.error('[🧦] WS:', err)
   }

   constructor(
      public options: {
         url: () => string
         /** upgrade-request headers (auth: X-API-Key & co) — a thunk, re-read on every reconnect.
          * On a headerless transport (browser) X-API-Key rides `?token=` instead
          * (the probed Comfy Cloud contract); other headers throw loud. */
         headers?: () => Record<string, string>
         onMessage: (event: WsMessageEvent) => void
         onConnectOrReconnect: () => void
         onClose: () => void
         /** transport unrecoverable (no ws package AND no global WebSocket, or ctor threw):
          * reported here ONCE, the client goes permanently closed — never a retry storm */
         onTransportDead?: (error: unknown) => void
         /**
          * the socket closed WITHOUT ever opening: nothing is listening there.
          * That is a definitive answer, not a blip, so it is reported instead of
          * retried and the caller decides. The 2s retry loop exists to heal an
          * ESTABLISHED session; spending it on a refused connect only makes every
          * waiter sit for the full connect deadline. No callback = retry as before.
          */
         onFirstConnectFailed?: (error: unknown) => void
         /** tests only: a fake socket instead of the ws package / browser WebSocket */
         transport?: WsTransport
         /** a host that vanishes (power loss, hard reboot) never sends a close frame, so the
          * socket would look open forever: every `heartbeatMs` it is pinged, and one without a
          * pong since the last ping is dropped, which starts the reconnect. Default 15s */
         heartbeatMs?: number
         /** pause before a reconnect. Default 2s */
         reconnectMs?: number
      },
   ) {
      this.url = options.url()
      void this.connect()
   }

   /** an established session heals by retrying; a first connect that never opened does not */
   private hasEverOpened: boolean = false

   private reconnectTimeout?: Maybe<ReturnType<typeof setTimeout>>
   private heartbeat: ReturnType<typeof setInterval> | null = null
   private permanentlyClosed: boolean = false

   private stopHeartbeat(): void {
      if (this.heartbeat != null) clearInterval(this.heartbeat)
      this.heartbeat = null
   }

   /** ping on a timer; no pong since the previous ping = the peer is gone, drop the socket */
   private startHeartbeat(ws: WsLike): void {
      this.stopHeartbeat()
      if (typeof ws.ping !== 'function' || typeof ws.on !== 'function') return
      let awaitingPong = false
      ws.on('pong', () => {
         awaitingPong = false
      })
      const ms = this.options.heartbeatMs ?? 15_000
      this.heartbeat = setInterval(() => {
         if (ws !== this.currentWS) return this.stopHeartbeat()
         if (awaitingPong) {
            this.addError(`no pong within ${ms}ms: the host is gone, dropping the socket to reconnect`)
            this.stopHeartbeat()
            if (typeof ws.terminate === 'function') ws.terminate()
            else ws.close()
            return
         }
         awaitingPong = true
         try {
            ws.ping?.()
         } catch (e) {
            this.addError(`ping failed: ${extractErrorMessage(e)}`)
         }
      }, ms)
   }

   /** close and stop reconnecting (lets a script exit cleanly) */
   disconnectPermanently(): void {
      this.permanentlyClosed = true
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
      this.stopHeartbeat()
      this.currentWS?.close()
      this.currentWS = null
      this.isOpen = false
   }

   /** headerless transports carry the api key as ?token= — everything else is refused loud */
   private headerlessUrl(headers: Record<string, string>): string {
      const rest = { ...headers }
      const apiKey = rest['X-API-Key']
      delete rest['X-API-Key']
      const extra = Object.keys(rest)
      if (extra.length > 0)
         throw new Error(
            `custom ws headers (${extra.join(', ')}) need the 'ws' package — a browser WebSocket cannot set upgrade headers`,
         )
      if (apiKey == null) return this.url
      return this.url + (this.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(apiKey)
   }

   private async connect(): Promise<void> {
      this.isOpen = false
      const prevWS = this.currentWS

      // cleanup a possible re-connection timeout for an other url
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
      this.stopHeartbeat()

      this.currentWS = null
      if (prevWS) {
         this.addInfo('Previous WebSocket discarded')
         prevWS.close()
      }

      let ws: WsLike
      try {
         const transport = this.options.transport ?? (await resolveWsTransport())
         if (this.permanentlyClosed) return // closed while the transport resolved
         const headers = this.options.headers?.() ?? {}
         ws = transport.supportsHeaders
            ? new transport.ctor(this.url, { headers })
            : new transport.ctor(this.headerlessUrl(headers))
      } catch (e) {
         // connect() runs void'd (ctor + reconnect timer): a rethrow here would be
         // an unhandled rejection, so the failure reports through onTransportDead
         this.addError(`cannot open WebSocket: ${extractErrorMessage(e)}`)
         this.permanentlyClosed = true
         this.options.onTransportDead?.(e)
         return
      }
      ws.binaryType = 'arraybuffer'

      this.currentWS = ws

      ws.onmessage = (event: WsMessageEvent): void => {
         this.options.onMessage(event)
      }

      ws.onopen = (): void => {
         if (ws !== this.currentWS) return
         this.addInfo('✅ WebSocket connected to ' + this.url)
         this.hasEverOpened = true
         this.isOpen = true
         this.options.onConnectOrReconnect()
         this.flushMessageBuffer()
         this.startHeartbeat(ws)
      }

      ws.onclose = (event: WsCloseEvent): void => {
         if (ws !== this.currentWS) return
         this.isOpen = false
         this.stopHeartbeat()
         this.options.onClose()
         if (this.permanentlyClosed) return
         this.addError(`WebSocket closed (reason=${JSON.stringify(event.reason)}, code=${event.code})`)
         // never opened = nothing is listening: report, do not retry (see the option)
         if (!this.hasEverOpened && this.options.onFirstConnectFailed != null) {
            this.permanentlyClosed = true
            this.options.onFirstConnectFailed(
               new Error(`connection refused (code=${event.code}${event.reason === '' ? '' : `, ${event.reason}`})`),
            )
            return
         }
         const wait = this.options.reconnectMs ?? 2000
         this.addInfo(`⏱️ reconnecting in ${wait / 1000} seconds...`)
         this.reconnectTimeout = setTimeout(() => void this.connect(), wait)
      }

      ws.onerror = (event: unknown): void => {
         if (ws !== this.currentWS) return
         this.addError(`WebSocket ERROR` + JSON.stringify(event))
         console.error({ event })
      }
   }

   public send(message: Message): void {
      if (this.isOpen) {
         this.currentWS?.send(message)
      } else {
         this.messageBuffer.push(message)
      }
   }

   private flushMessageBuffer(): void {
      while (this.messageBuffer.length > 0) {
         const message = bang(this.messageBuffer.shift())
         this.currentWS?.send(message)
      }
   }
}
