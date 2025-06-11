import WebSocket, { type CloseEvent, type Event, type MessageEvent } from 'ws'
import type { Maybe } from '../types'
import { bang } from '../utils/bang'

type Message = string | Buffer

type WsDebugMessage = {
   type: 'info' | 'error'
   timestamp: number
   message: string
}

export class ResilientWebSocketClient {
   // private protocols?: string | string[]
   private url: string
   private currentWS?: Maybe<WebSocket>
   private messageBuffer: Message[] = []

   isOpen: boolean = false
   debugMessages: WsDebugMessage[] = []

   private addInfo(msg: string): void {
      this.debugMessages.push({ type: 'info', timestamp: Date.now(), message: msg })
      console.info('[🧦] WS:', msg)
   }

   private addError(err: string): void {
      this.debugMessages.push({ type: 'error', timestamp: Date.now(), message: err })
      console.error('[🧦] WS:', err)
   }

   constructor(
      public options: {
         url: () => string /*protocols?: string | string[]*/
         onMessage: (event: MessageEvent) => void
         onConnectOrReconnect: () => void
         onClose: () => void
      },
   ) {
      this.url = options.url()
   }

   private reconnectTimeout?: Maybe<NodeJS.Timeout>

   private connect(): void {
      this.isOpen = false
      const prevWS = this.currentWS

      // cleanup a possible re-connection timeout for an other url
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)

      this.currentWS = null
      if (prevWS) {
         this.addInfo('Previous WebSocket discarded')
         prevWS.close()
      }
      const ws = new WebSocket(this.url)
      ws.binaryType = 'arraybuffer'

      this.currentWS = ws

      if (this.options.onMessage) {
         ws.onmessage = (event: MessageEvent): void => {
            this.options.onMessage(event)
         }
      }

      ws.onopen = (_event: Event): void => {
         if (ws !== this.currentWS) return
         this.addInfo('✅ WebSocket connected to ' + this.url)
         this.isOpen = true
         this.options.onConnectOrReconnect()
         this.flushMessageBuffer()
      }

      ws.onclose = (event: CloseEvent): void => {
         if (ws !== this.currentWS) return
         this.addError(`WebSocket closed (reason=${JSON.stringify(event.reason)}, code=${event.code})`)
         this.isOpen = false
         this.addInfo('⏱️ reconnecting in 2 seconds...')
         this.reconnectTimeout = setTimeout(() => this.connect(), 2000) // Attempt to reconnect after 5 seconds
      }

      ws.onerror = (event: Event): void => {
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

   /** forward WebSocket add event listeners to the current WebSocket instance */
   public addEventListener<K extends keyof WebSocketEventMap>(
      type: K,
      listener:
         | ((event: WebSocket.WebSocketEventMap[K]) => void)
         | { handleEvent(event: WebSocket.WebSocketEventMap[K]): void },
      options?: WebSocket.EventListenerOptions,
   ): void {
      this.currentWS?.addEventListener(type, listener, options)
   }

   /** forward WebSocket remove event listeners to the current WebSocket instance */
   public removeEventListener<K extends keyof WebSocketEventMap>(
      type: K,
      listener:
         | ((event: WebSocket.WebSocketEventMap[K]) => void)
         | { handleEvent(event: WebSocket.WebSocketEventMap[K]): void },
   ): void {
      this.currentWS?.removeEventListener(type, listener)
   }
}

type WebSocketEventMap = {
   open: Event
   close: CloseEvent
   error: Event
   message: MessageEvent
}
