import { describe, expect, it } from 'bun:test'
import { parseArgs, sameOrigin, reachableAddresses, type Nic } from 'src/cli/serve/run-serve.ts'

describe('comfy-ts serve --host', () => {
   it('binds loopback by default and takes --host, with --bind kept as an alias', () => {
      expect(parseArgs([])).toEqual({ target: undefined, port: 8288, bind: '127.0.0.1', cors: false })
      expect(parseArgs(['--host', '0.0.0.0'])).toEqual({
         target: undefined,
         port: 8288,
         bind: '0.0.0.0',
         cors: false,
      })
      // cross-origin access is opt-in, never the default
      expect(parseArgs(['--cors'])).toEqual({ target: undefined, port: 8288, bind: '127.0.0.1', cors: true })
      expect(parseArgs(['--bind', '100.64.0.7'])).toEqual({
         target: undefined,
         port: 8288,
         bind: '100.64.0.7',
         cors: false,
      })
   })

   it('a flag with no value fails loudly instead of eating the next argument', () => {
      expect(parseArgs(['--host'])).toEqual({
         error: '--host expects an address (0.0.0.0 to reach it from another machine)',
      })
   })

   it('--host composes with a target and a port', () => {
      expect(parseArgs(['./flows', '--host', '0.0.0.0', '--port', '9000'])).toEqual({
         target: './flows',
         port: 9000,
         bind: '0.0.0.0',
         cors: false,
      })
   })
})

describe('reachable addresses printed at startup', () => {
   const nics: Record<string, Nic[] | undefined> = {
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [
         { address: '192.168.1.42', family: 'IPv4', internal: false },
         { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      utun3: [{ address: '100.101.102.103', family: 'IPv4', internal: false }],
   }

   it('0.0.0.0 expands to every real interface, tailnet included — that is the point of printing it', () => {
      expect(reachableAddresses('0.0.0.0', nics)).toEqual(['127.0.0.1', '192.168.1.42', '100.101.102.103'])
   })

   it('an explicit address is printed as given, never expanded', () => {
      expect(reachableAddresses('192.168.1.42', nics)).toEqual(['192.168.1.42'])
      expect(reachableAddresses('127.0.0.1', nics)).toEqual(['127.0.0.1'])
   })

   it('node reporting family as the number 4 is handled like the string form', () => {
      const numeric: Record<string, Nic[] | undefined> = { en1: [{ address: '10.0.0.5', family: 4, internal: false }] }
      expect(reachableAddresses('0.0.0.0', numeric)).toEqual(['127.0.0.1', '10.0.0.5'])
   })
})

describe('same-origin check', () => {
   it('matches host and port, and a missing host is never a match', () => {
      expect(sameOrigin('http://127.0.0.1:8288', '127.0.0.1:8288')).toBe(true)
      expect(sameOrigin('http://127.0.0.1:8288', '127.0.0.1:9000')).toBe(false)
      expect(sameOrigin('https://evil.example', '127.0.0.1:8288')).toBe(false)
      expect(sameOrigin('null', '127.0.0.1:8288')).toBe(false)
      expect(sameOrigin('http://127.0.0.1:8288', undefined)).toBe(false)
   })
})
