import { describe, expect, it } from 'bun:test'
import { applyVarPayload } from 'src/cli/serve/applyVarPayload.ts'
import { describeVar } from 'src/cli/serve/describeVar.ts'
import { v } from 'src/vars/ComfyVars.ts'

describe('serve payload application', () => {
   it('text and prompt take strings, reject everything else', () => {
      const t = v.text('a')
      expect(applyVarPayload(t, 'hello')).toBeNull()
      expect(t.value).toBe('hello')
      expect(applyVarPayload(t, 42)).toContain('expects a string')
      const p = v.prompt('x')
      expect(applyVarPayload(p, 'cat\n- blurry')).toBeNull()
      expect(p.outValue()).toEqual({ positive: 'cat', negative: 'blurry' })
   })

   it('int clamps numbers, parses numeric strings, names the range in errors', () => {
      const steps = v.int(8, { min: 1, max: 40 })
      steps.name = 'steps'
      expect(applyVarPayload(steps, 999)).toBeNull()
      expect(steps.value).toBe(40)
      expect(applyVarPayload(steps, '12')).toBeNull()
      expect(steps.value).toBe(12)
      const err = applyVarPayload(steps, 'nope')
      expect(err).toContain("'steps'")
      expect(err).toContain('1..40')
   })

   it('seed: bare number goes FIXED, {mode,value} is honored, garbage rejected', () => {
      const seed = v.seed(0)
      seed.setMode('+')
      expect(applyVarPayload(seed, 55)).toBeNull()
      expect(seed.value).toBe(55)
      expect(seed.mode).toBe('=')
      expect(applyVarPayload(seed, { mode: '?' })).toBeNull()
      expect(seed.mode).toBe('?')
      expect(applyVarPayload(seed, { mode: 'x' })).toContain('mode must be one of')
      expect(applyVarPayload(seed, { value: 'NaN' })).toContain('value must be a number')
      expect(applyVarPayload(seed, {})).toContain('give "mode" and/or "value"')
      expect(applyVarPayload(seed, 'abc')).toContain('expects a number')
   })

   it('toggle wants a real boolean', () => {
      const on = v.toggle(false)
      expect(applyVarPayload(on, true)).toBeNull()
      expect(on.value).toBe(true)
      expect(applyVarPayload(on, 'true')).toContain('expects true or false')
   })

   it('choice enforces membership and echoes the choices', () => {
      const sampler = v.choice(['euler', 'ddim'] as const, 'euler')
      sampler.name = 'sampler'
      expect(applyVarPayload(sampler, 'ddim')).toBeNull()
      expect(sampler.value).toBe('ddim')
      const err = applyVarPayload(sampler, 'dpmpp')
      expect(err).toContain('euler')
      expect(err).toContain('ddim')
   })

   it('loras: unknown names and bad strengths rejected BEFORE applying, valid records land', () => {
      const loras = v.loras(['a.safetensors', 'b.safetensors'] as const)
      loras.name = 'loras'
      expect(applyVarPayload(loras, { 'c.safetensors': 1 })).toContain('unknown lora')
      expect(applyVarPayload(loras, { 'a.safetensors': 'strong' })).toContain('must be false | true | number')
      expect(loras.activeNames()).toEqual([]) // nothing applied by the failed attempts
      expect(applyVarPayload(loras, { 'a.safetensors': 0.8, 'b.safetensors': [1, 0.5] })).toBeNull()
      expect(loras.activeNames()).toEqual(['a.safetensors', 'b.safetensors'])
      expect(applyVarPayload(loras, [1, 2])).toContain('expects {')
   })

   it('size takes {width,height}, "WxH" strings, preset labels', () => {
      const size = v.size({ width: 512, height: 512 })
      expect(applyVarPayload(size, { width: 1024, height: 768 })).toBeNull()
      expect(size.value).toEqual({ width: 1024, height: 768 })
      expect(applyVarPayload(size, '640x480')).toBeNull()
      expect(size.value).toEqual({ width: 640, height: 480 })
      expect(applyVarPayload(size, '1:1 square')).toBeNull()
      expect(size.value).toEqual({ width: 1024, height: 1024 })
      expect(applyVarPayload(size, { width: 'w' })).toContain('expects {"width"')
   })

   it('image takes a path string (existence is the caller’s check)', () => {
      const img = v.image('')
      expect(applyVarPayload(img, '/tmp/x.png')).toBeNull()
      expect(img.value).toBe('/tmp/x.png')
      expect(applyVarPayload(img, 42)).toContain('expects a file path')
   })
})

describe('serve var descriptors', () => {
   it('every kind self-describes with its allowed values', () => {
      expect(describeVar(v.int(8, { min: 1, max: 40 }))).toMatchObject({ kind: 'int', min: 1, max: 40, default: 8 })
      expect(describeVar(v.choice(['a', 'b'] as const, 'a')).choices).toEqual(['a', 'b'])
      expect(describeVar(v.loras(['x.safetensors'] as const)).options).toEqual(['x.safetensors'])
      expect(describeVar(v.seed(42)).default).toEqual({ mode: '=', value: 42 })
      expect(describeVar(v.size()).presets?.length).toBeGreaterThan(0)
      expect(describeVar(v.image('')).extensions).toContain('png')
      expect(describeVar(v.toggle(true))).toMatchObject({ kind: 'toggle', default: true })
      expect(describeVar(v.prompt('x')).payload).toContain('negative')
      expect(describeVar(v.text('x')).payload).toBe('string')
   })
})
