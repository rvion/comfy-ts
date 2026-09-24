import { describe, expect, it } from 'bun:test'
import {
   flattenLoras,
   isLoraLanes,
   isLorasInput,
   isPromptInput,
   moveLane,
   moveLoraToLane,
   newLaneName,
   patchLane,
   promptFromLanes,
   promptLanesFromText,
   promptLanesToText,
   promptText,
   removeLane,
   toLoraLanes,
   toPromptLanes,
   updateLora,
} from 'src/vars/lanes.ts'

describe('prompt lanes', () => {
   it('a plain string reads exactly as before', () => {
      expect(promptText('a cat\n- blurry')).toBe('a cat\n- blurry')
   })

   it('the active lanes merge in listed order, an inactive one is skipped', () => {
      const v = {
         lanes: [
            { name: 'subject', prompt: 'a cat', active: true },
            { name: 'wip', prompt: 'on fire', active: false },
            { name: 'style', prompt: 'flat colors\n- blurry', active: true },
         ],
      }
      expect(promptText(v)).toBe('a cat\nflat colors\n- blurry')
   })

   it('switching in makes one lane of the current text, switching out only when nothing is lost', () => {
      const lanes = toPromptLanes('a cat')
      expect(lanes).toEqual({ lanes: [{ name: 'main', prompt: 'a cat', active: true }] })
      expect(promptFromLanes(lanes)).toBe('a cat')
      expect(promptFromLanes({ lanes: [...lanes.lanes, { name: 'b', prompt: 'x', active: true }] })).toBeNull()
   })

   it('the TUI text form round-trips, inactive lanes included', () => {
      const v = {
         lanes: [
            { name: 'subject', prompt: 'a cat\n- blurry', active: true },
            { name: 'style', prompt: 'flat', active: false },
         ],
      }
      expect(promptLanesToText(v)).toBe('# subject\na cat\n- blurry\n# style (off)\nflat')
      expect(promptLanesFromText(promptLanesToText(v))).toEqual(v)
   })

   it('text typed above the first header is kept in a lane of its own', () => {
      expect(promptLanesFromText('loose line\n# style\nflat').lanes.map((l) => l.name)).toEqual(['main', 'style'])
   })

   it('guards: both shapes pass, anything else is refused', () => {
      expect(isPromptInput('x')).toBe(true)
      expect(isPromptInput({ lanes: [{ name: 'a', prompt: 'x', active: true }] })).toBe(true)
      expect(isPromptInput({ lanes: [{ name: 'a', prompt: 3, active: true }] })).toBe(false)
      expect(isPromptInput(42)).toBe(false)
   })
})

describe('lora lanes', () => {
   it('a plain record is not mistaken for lanes, and lanes are not mistaken for a record', () => {
      expect(isLoraLanes({ 'a.safetensors': 1 })).toBe(false)
      expect(isLoraLanes({ lanes: [{ name: 'x', active: true, loras: { a: 1 } }] })).toBe(true)
      expect(isLorasInput({ lanes: 'nope' })).toBe(false)
   })

   it('the build reads the active lanes in order, first setting wins, duplicates are named', () => {
      const v = {
         lanes: [
            { name: 'style', active: true, loras: { a: [0.8, 0.8] as [number, number], b: 1 } },
            { name: 'off', active: false, loras: { c: 1 } },
            { name: 'detail', active: true, loras: { d: 0.5, a: 0.2 } },
         ],
      }
      const flat = flattenLoras(v)
      expect(Object.keys(flat.record)).toEqual(['a', 'b', 'd'])
      expect(flat.record.a).toEqual([0.8, 0.8])
      expect(flat.duplicates).toEqual(['a'])
   })

   it('an edit lands in the lane that holds the lora, a new one in the first lane', () => {
      const v = toLoraLanes({ a: 1 })
      const two = { lanes: [...v.lanes, { name: 'b', active: true, loras: { x: 1 } }] }
      expect(updateLora(two, 'x', 0.5)).toEqual({
         lanes: [
            { name: 'main', active: true, loras: { a: 1 } },
            { name: 'b', active: true, loras: { x: 0.5 } },
         ],
      })
      expect(updateLora(two, 'new', 1).lanes[0]?.loras).toEqual({ a: 1, new: 1 })
      expect(updateLora({ lanes: [] }, 'z', 1)).toEqual({ lanes: [{ name: 'main', active: true, loras: { z: 1 } }] })
   })
})

describe('lane list edits', () => {
   const three = [
      { name: 'a', active: true },
      { name: 'b', active: true },
      { name: 'c', active: false },
   ]

   it('new lanes get a free name', () => {
      expect(newLaneName(three)).toBe('lane 4')
      expect(newLaneName([{ name: 'lane 2', active: true }])).toBe('lane 3')
   })

   it('move, rename, switch off, remove', () => {
      expect(moveLane(three, 2, -1).map((l) => l.name)).toEqual(['a', 'c', 'b'])
      expect(moveLane(three, 0, -1).map((l) => l.name)).toEqual(['a', 'b', 'c'])
      expect(patchLane(three, 1, { name: 'style', active: false })[1]).toEqual({ name: 'style', active: false })
      expect(removeLane(three, 0).map((l) => l.name)).toEqual(['b', 'c'])
   })

   it('a lora moves to another lane, before a given lora or last, keeping its setting', () => {
      const v = {
         lanes: [
            { name: 'x', active: true, loras: { a: 0.5, b: 1 } },
            { name: 'y', active: true, loras: { c: 1, d: 1 } },
         ],
      }
      const moved = moveLoraToLane(v, { from: 0, name: 'a', to: 1, beforeName: 'd' })
      expect(moved.lanes[0]?.loras).toEqual({ b: 1 })
      expect(Object.keys(moved.lanes[1]?.loras ?? {})).toEqual(['c', 'a', 'd'])
      expect(moved.lanes[1]?.loras.a).toBe(0.5)
      expect(Object.keys(moveLoraToLane(v, { from: 1, name: 'c', to: 0 }).lanes[0]?.loras ?? {})).toEqual([
         'a',
         'b',
         'c',
      ])
   })
})
