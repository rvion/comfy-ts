import { describe, expect, it } from 'bun:test'
import { addressNote, boxed, renderStartupLines, type StartupInput } from 'src/cli/serve/startupPrint.ts'
import { stripAnsi } from 'src/utils/ansi.ts'

function input(over: Partial<StartupInput> = {}): StartupInput {
   return {
      bind: '127.0.0.1',
      port: 8288,
      urls: ['127.0.0.1'],
      color: false,
      modules: [
         {
            key: '01-txt2img',
            hostId: 'my-gpu',
            routes: ['http://127.0.0.1:8288/generate/01-txt2img/default'],
            varLines: ['   prompt  prompt  string'],
         },
         {
            key: '04-krea2',
            hostId: 'my-gpu',
            routes: ['http://127.0.0.1:8288/generate/04-krea2/default'],
            varLines: ['   seed    seed    number'],
         },
      ],
      ...over,
   }
}

describe('serve startup print', () => {
   it('separates workflows with a rule, one per module', () => {
      const lines = renderStartupLines(input())
      const rules = lines.filter((l) => /^─+$/.test(l))
      // one above each module + the closing one
      expect(rules).toHaveLength(3)
      expect(lines.some((l) => l.startsWith('01-txt2img'))).toBe(true)
      expect(lines.some((l) => l.startsWith('04-krea2'))).toBe(true)
   })

   it('ends on a box naming the web ui, and hints --host/--bind while bound to loopback', () => {
      const lines = renderStartupLines(input())
      const last = lines.at(-1) ?? ''
      expect(last.startsWith('└')).toBe(true)
      const box = lines.slice(lines.findIndex((l) => l.startsWith('┌')))
      const text = box.join('\n')
      expect(text).toContain('web ui')
      expect(text).toContain('http://127.0.0.1:8288/')
      expect(text).toContain('--host 0.0.0.0')
      expect(text).toContain('--bind')
   })

   it('bound wide, the box lists the other urls and drops the hint, and the no-auth warning shows', () => {
      const lines = renderStartupLines(input({ bind: '0.0.0.0', urls: ['127.0.0.1', '192.168.1.42', '100.100.1.2'] }))
      const text = lines.join('\n')
      expect(text).toContain('NO AUTH')
      expect(text).toContain('http://192.168.1.42:8288/')
      expect(text).toContain('(tailnet)')
      expect(text).not.toContain('--host 0.0.0.0')
   })

   it('colors are a PARAMETER: off means not a single escape byte (piped output stays greppable)', () => {
      const plain = renderStartupLines(input()).join('\n')
      expect(plain).not.toContain('\x1b')
      const colored = renderStartupLines(input({ color: true })).join('\n')
      expect(colored).toContain('\x1b[')
      // same text underneath, so a color terminal and a pipe show the same information
      expect(stripAnsi(colored)).toBe(plain)
   })

   it('the box stays square, colors or not — padding measures VISIBLE width', () => {
      for (const color of [false, true]) {
         const lines = renderStartupLines(input({ color, bind: '0.0.0.0', urls: ['127.0.0.1', '100.100.1.2'] }))
         const box = lines.slice(lines.findIndex((l) => l.startsWith('┌') || l.includes('┌')))
         const widths = new Set(box.map((l) => [...stripAnsi(l)].length))
         expect(widths.size, `box lines misaligned with color=${color}`).toBe(1)
      }
   })

   it('boxed() sizes to the longest visible line', () => {
      const out = boxed(['ab', 'abcd'])
      expect(out).toEqual(['┌──────┐', '│ ab   │', '│ abcd │', '└──────┘'])
   })

   it('addresses are labelled so the useful one is obvious on a phone', () => {
      expect(addressNote('100.101.102.103')).toBe('tailnet')
      expect(addressNote('127.0.0.1')).toBe('this machine')
      expect(addressNote('192.168.1.42')).toBe('')
      // 100.x outside the CGNAT range is a normal public address, not a tailnet one
      expect(addressNote('100.20.30.40')).toBe('')
   })
})
