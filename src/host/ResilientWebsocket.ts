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
}

/** what both transports deliver with binaryType 'arraybuffer': string or ArrayBuffer in `data` */
export type WsMessageEvent = { data: unknown }
export type WsCloseEvent = { code: number; reason: string }

type WsCtor = new (url: string, opts?: { headers?: Record<string, string> }) => WsLike

type WsTransport = { ctor: WsCtor; supportsHeaders: boolean }

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
      },
   ) {
      this.url = options.url()
      void this.connect()
   }

   private reconnectTimeout?: Maybe<ReturnType<typeof setTimeout>>
   private permanentlyClosed: boolean = false

   /** close and stop reconnecting (lets a script exit cleanly) */
   disconnectPermanently(): void {
      this.permanentlyClosed = true
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
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

      this.currentWS = null
      if (prevWS) {
         this.addInfo('Previous WebSocket discarded')
         prevWS.close()
      }

      let ws: WsLike
      try {
         const transport = await resolveWsTransport()
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
         this.isOpen = true
         this.options.onConnectOrReconnect()
         this.flushMessageBuffer()
      }

      ws.onclose = (event: WsCloseEvent): void => {
         if (ws !== this.currentWS) return
         this.isOpen = false
         this.options.onClose()
         if (this.permanentlyClosed) return
         this.addError(`WebSocket closed (reason=${JSON.stringify(event.reason)}, code=${event.code})`)
         this.addInfo('⏱️ reconnecting in 2 seconds...')
         this.reconnectTimeout = setTimeout(() => void this.connect(), 2000)
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
