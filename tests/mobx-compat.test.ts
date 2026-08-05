// the mobx-major seam must hold on BOTH majors: the dep range accepts ^6.16.1 || ^7.0.0.
// this file runs against whichever mobx the repo resolved, so the whole suite stays green
// on either major. the real mobx 6 leg is a release-time run, see agent/coding.md stack pins.
import { describe, expect, it } from 'bun:test'
import * as mobx from 'mobx'
import { observableRef, resolveObservableRef, type MobxAnnotationSource } from 'src/cli/tui/mobxCompat.ts'

describe('mobx 6/7 compat seam', () => {
   it('resolves an annotation on the repo-resolved mobx, whichever spelling it ships', () => {
      const src: MobxAnnotationSource = mobx
      expect(resolveObservableRef(mobx)).toBeDefined()
      expect(resolveObservableRef(mobx)).toBe(src.observableRef ?? src.observable.ref)
      expect(observableRef).toBe(resolveObservableRef(mobx))
   })

   it('prefers the mobx 7 named export, falls back to the mobx 6 namespace spelling', () => {
      const ref6 = Symbol('observable.ref')
      const ref7 = Symbol('observableRef')
      expect(resolveObservableRef({ observableRef: ref7, observable: { map: null } })).toBe(ref7)
      expect(resolveObservableRef({ observable: { map: null, ref: ref6 } })).toBe(ref6)
   })

   it('the exported observableRef drives makeAutoObservable: reactive, and by reference', () => {
      class Store {
         wf: { n: number } | null = null
         constructor() {
            mobx.makeAutoObservable(this, { wf: observableRef })
         }
         setWf(p: { n: number } | null) {
            this.wf = p
         }
      }
      const store = new Store()
      let fired = 0
      const stop = mobx.reaction(
         () => store.wf,
         () => fired++,
      )
      const next = { n: 1 }
      store.setWf(next)
      expect(fired).toBe(1)
      // ref annotation means the foreign object is NOT proxied
      expect(store.wf).toBe(next)
      expect(mobx.isObservable(store.wf)).toBe(false)
      stop()
   })
})
