import { describe, expect, it } from 'bun:test'
import { createServer } from 'node:http'
import { type AddressInfo, createServer as createNetServer } from 'node:net'
import { listenUntilClosed } from 'src/cli/serve/run-serve.ts'

const within = <T>(p: Promise<T>, ms: number): Promise<T | 'still running'> =>
   Promise.race([p, new Promise<'still running'>((r) => setTimeout(() => r('still running'), ms))])

describe('comfy-ts serve on a taken port', () => {
   it('control: a free port serves until the server closes, then resolves 0', async () => {
      const server = createServer()
      const done = listenUntilClosed(server, 0, '127.0.0.1')
      if (!server.listening) await new Promise((r) => server.once('listening', r))
      server.close()
      expect(await within(done, 1000)).toBe(0)
   })

   it('fails at once with exit 1, naming the port and what holds it', async () => {
      // why we think it is actually a bug, and not just meaning spec should change: a server that cannot listen has nothing to serve, yet the process never ended. The close event that resolved its exit never fires for a server that never listened, so the cli awaited forever, and bun spins a core on a pending top level await with nothing else alive
      const holder = createNetServer()
      await new Promise<void>((r) => holder.listen(0, '127.0.0.1', r))
      const port = (holder.address() as AddressInfo).port
      const errors: string[] = []
      const prevError = console.error
      console.error = (...a: unknown[]) => errors.push(a.map(String).join(' '))
      try {
         expect(await within(listenUntilClosed(createServer(), port, '127.0.0.1'), 1000)).toBe(1)
         const said = errors.join('\n')
         expect(said).toContain(`port ${port}`)
         // the holder is this very process
         if (Bun.which('lsof') != null) expect(said).toContain(`pid ${process.pid}`)
      } finally {
         console.error = prevError
         holder.close()
      }
   })
})
