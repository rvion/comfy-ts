import { describe, expect, test } from 'bun:test'
import { parseHostBase, renderHttpBase, renderWsUrl } from 'src/host/hostUrl.ts'

describe('parseHostBase — url-first form', () => {
   test('bare https url: implicit 443, empty basePath', () => {
      const q = parseHostBase({ id: 'cloud', url: 'https://cloud.comfy.org' })
      expect(q).toEqual({ scheme: 'https', host: 'cloud.comfy.org', port: 443, basePath: '' })
   })

   test('http url with explicit port and base path', () => {
      const q = parseHostBase({ id: 'lan', url: 'http://192.168.1.5:8188/comfy' })
      expect(q).toEqual({ scheme: 'http', host: '192.168.1.5', port: 8188, basePath: '/comfy' })
   })

   test('trailing slash is normalized away', () => {
      const q = parseHostBase({ id: 'modal', url: 'https://xxx.modal.run/' })
      expect(q.basePath).toBe('')
      const q2 = parseHostBase({ id: 'lan', url: 'http://a:1/b/' })
      expect(q2.basePath).toBe('/b')
   })

   test('http url without port defaults to 80', () => {
      const q = parseHostBase({ id: 'h', url: 'http://example.com' })
      expect(q.port).toBe(80)
   })

   test('non-http scheme throws loud', () => {
      expect(() => parseHostBase({ id: 'h', url: 'ftp://example.com' })).toThrow('http')
   })

   test('query or hash in the url throws loud', () => {
      expect(() => parseHostBase({ id: 'h', url: 'https://a.com/x?y=1' })).toThrow()
      expect(() => parseHostBase({ id: 'h', url: 'https://a.com/x#y' })).toThrow()
   })

   test('unparseable url throws loud', () => {
      expect(() => parseHostBase({ id: 'h', url: 'not a url' })).toThrow()
   })
})

describe('parseHostBase — legacy host/port/https form', () => {
   test('host+port renders exactly as today', () => {
      const q = parseHostBase({ id: 'w1', host: 'desktop-im18794', port: 8085 })
      expect(q).toEqual({ scheme: 'http', host: 'desktop-im18794', port: 8085, basePath: '' })
   })

   test('https flag picks the https scheme', () => {
      const q = parseHostBase({ id: 'r', host: 'xxx.proxy.runpod.net', port: 443, https: true })
      expect(q.scheme).toBe('https')
   })

   test('both url and host/port throws loud', () => {
      expect(() => parseHostBase({ id: 'h', url: 'http://a:1', host: 'a', port: 1 })).toThrow()
   })

   test('neither url nor complete host+port throws loud', () => {
      expect(() => parseHostBase({ id: 'h' })).toThrow()
      expect(() => parseHostBase({ id: 'h', host: 'a' })).toThrow()
      expect(() => parseHostBase({ id: 'h', port: 8188 })).toThrow()
   })
})

describe('renderHttpBase / renderWsUrl', () => {
   test('scheme-default port is omitted', () => {
      const q = parseHostBase({ id: 'c', url: 'https://cloud.comfy.org' })
      expect(renderHttpBase(q)).toBe('https://cloud.comfy.org')
      expect(renderWsUrl(q)).toBe('wss://cloud.comfy.org/ws')
   })

   test('non-default port and basePath are kept', () => {
      const q = parseHostBase({ id: 'lan', url: 'http://192.168.1.5:8188/comfy' })
      expect(renderHttpBase(q)).toBe('http://192.168.1.5:8188/comfy')
      expect(renderWsUrl(q)).toBe('ws://192.168.1.5:8188/comfy/ws')
   })

   test('legacy spelling round-trips like today', () => {
      const q = parseHostBase({ id: 'w1', host: 'desktop-im18794', port: 8085 })
      expect(renderHttpBase(q)).toBe('http://desktop-im18794:8085')
      expect(renderWsUrl(q)).toBe('ws://desktop-im18794:8085/ws')
   })
})
