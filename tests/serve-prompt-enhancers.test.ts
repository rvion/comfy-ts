import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { listPromptEnhancers, promptEnhancersDir } from 'src/cli/serve/promptEnhancers.ts'
import { validStoreName } from 'src/cli/serve/safeName.ts'
import { ServeApp, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

// process-wide global: this file owns ONE temp-root instance, restored after
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-enhancers-')) })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

function makeApp(): ServeApp {
   const host = comfy.host({ id: 'enh-host', host: '127.0.0.1', port: 65500 })
   const dw = host.defineWorkflow({ id: 'wf', vars: { prompt: v.prompt('hi') }, build: () => {} })
   const mod: ServeModule = { key: 'wf', file: '/fake/wf.cflow.ts', dw }
   return new ServeApp([mod], { starter: () => Promise.reject(new Error('never runs here')) })
}

function body(reply: { body: string }): Record<string, unknown> {
   return JSON.parse(reply.body) as Record<string, unknown>
}

describe('the shared name gate', () => {
   it('accepts ordinary names and refuses everything that could escape the folder', () => {
      expect(validStoreName('refine-krea2-prompt')).toBe('refine-krea2-prompt')
      expect(validStoreName('  spaced name 2 ')).toBe('spaced name 2')
      expect(validStoreName('../../etc/passwd')).toBeNull()
      expect(validStoreName('a/b')).toBeNull()
      expect(validStoreName('.hidden')).toBeNull()
      expect(validStoreName('')).toBeNull()
      expect(validStoreName('x'.repeat(101))).toBeNull()
   })
})

describe('prompt enhancers live in .comfy-ts/prompt-enhancers/', () => {
   it('the first read SEEDS refine-krea2-prompt.md, so there is a file to hand-edit', () => {
      const list = listPromptEnhancers()
      expect(list.map((e) => e.name)).toEqual(['refine-krea2-prompt'])
      expect(existsSync(join(promptEnhancersDir(), 'refine-krea2-prompt.md'))).toBe(true)
      expect(list[0]?.text).toContain('krea2 turbo')
   })

   it('a file edited on disk is what the next read returns (the disk is the source of truth)', () => {
      writeFileSync(join(promptEnhancersDir(), 'refine-krea2-prompt.md'), 'edited by hand')
      expect(listPromptEnhancers()[0]?.text).toBe('edited by hand')
   })

   it('GET lists them, PUT writes a real .md file, DELETE removes it', async () => {
      const app = makeApp()
      const put = await app.handle({
         method: 'PUT',
         url: '/prompt-enhancers/refine-qwen-prompt',
         body: JSON.stringify({ text: 'rewrite for qwen' }),
      })
      expect(put.status).toBe(200)
      expect(readFileSync(join(promptEnhancersDir(), 'refine-qwen-prompt.md'), 'utf8')).toBe('rewrite for qwen')

      const get = await app.handle({ method: 'GET', url: '/prompt-enhancers' })
      const enhancers = body(get) as { enhancers: { name: string; text: string }[] }
      expect(enhancers.enhancers.map((e) => e.name)).toContain('refine-qwen-prompt')

      const del = await app.handle({ method: 'DELETE', url: '/prompt-enhancers/refine-qwen-prompt' })
      expect(del.status).toBe(200)
      expect(existsSync(join(promptEnhancersDir(), 'refine-qwen-prompt.md'))).toBe(false)
   })

   it('a %2F traversal name is refused on WRITE and on DELETE, not just filtered on read', async () => {
      const app = makeApp()
      // handle() decodes per segment, so this arrives as a real '/' inside one segment
      const put = await app.handle({
         method: 'PUT',
         url: `/prompt-enhancers/${encodeURIComponent('../../evil')}`,
         body: JSON.stringify({ text: 'pwned' }),
      })
      expect(put.status).toBe(400)
      const del = await app.handle({
         method: 'DELETE',
         url: `/prompt-enhancers/${encodeURIComponent('../../evil')}`,
      })
      expect(del.status).toBe(400)
      expect(existsSync(join(promptEnhancersDir(), '..', '..', 'evil.md'))).toBe(false)
   })

   it('a body without a text string is a 400, so a bad client cannot blank a master prompt', async () => {
      const app = makeApp()
      expect((await app.handle({ method: 'PUT', url: '/prompt-enhancers/x', body: '{}' })).status).toBe(400)
      expect((await app.handle({ method: 'PUT', url: '/prompt-enhancers/x', body: 'not json' })).status).toBe(400)
      expect((await app.handle({ method: 'PUT', url: '/prompt-enhancers/x', body: '{"text":7}' })).status).toBe(400)
   })
})
