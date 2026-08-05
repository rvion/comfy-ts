// the ONE mobx-major seam. mobx 6 and 7 differ in exactly two places this repo
// touches: the ref annotation spelling (observable.ref on 6, observableRef on 7),
// and the react binding package, whose every major peer-pins one mobx major.
// tui code imports observer and observableRef from here, never from mobx-react-lite,
// so the dependency tree pins no mobx major and the consumer's copy dedupes to one.
// observer is adapted from mobx-react-lite v5 (MIT), trimmed to plain function
// components (no forwardRef, no static rendering, both unused here). it only needs
// Reaction, an API identical in mobx 6 and 7.
import * as mobx from 'mobx'
import type { AnnotationMapEntry } from 'mobx'
import { memo, useRef, useSyncExternalStore, type FunctionComponent, type NamedExoticComponent } from 'react'
import { bang } from 'src/utils/bang.ts'

// structural face over the mobx namespace, both majors fit (map anchors the
// observable factory so the face is not a weak type)
export type MobxAnnotationSource = {
   observableRef?: unknown
   observable: { map: unknown; ref?: unknown }
}

export const resolveObservableRef = (p: MobxAnnotationSource): unknown => p.observableRef ?? p.observable.ref

// cast whitelist family 10: same annotation object on both majors, claimed as
// AnnotationMapEntry, a type BOTH majors export (naming the v7-only export here
// would break typechecking for a mobx 6 consumer importing this file via src/*)
export const observableRef = bang(
   resolveObservableRef(mobx),
   'mobx exports neither observableRef (v7) nor observable.ref (v6)',
) as AnnotationMapEntry

type ObserverAdmin = {
   reaction: mobx.Reaction | null
   // also the mounted flag, useSyncExternalStore sets it on subscribe
   onStoreChange: (() => void) | null
   // ticks on every reaction fire so getSnapshot reports a change
   stateVersion: symbol
   name: string
   // stable identities, useSyncExternalStore resubscribes if these change
   subscribe: (onStoreChange: () => void) => () => void
   getSnapshot: () => symbol
}

const createReaction = (p: ObserverAdmin): mobx.Reaction => {
   const reaction = new mobx.Reaction(`observer${p.name}`, () => {
      p.stateVersion = Symbol()
      // between first render and mount there is no listener yet,
      // useSyncExternalStore catches up via getSnapshot on mount
      p.onStoreChange?.()
   })
   p.reaction = reaction
   return reaction
}

// a render react abandons (never commits) would leak its reaction forever,
// the registry disposes it once the abandoned component is collected
const abandonedRenders =
   typeof FinalizationRegistry === 'undefined'
      ? null
      : new FinalizationRegistry<ObserverAdmin>((p) => {
           p.reaction?.dispose()
           p.reaction = null
        })

const useObserver = <T>(render: () => T, name: string): T => {
   const admRef = useRef<ObserverAdmin | null>(null)
   if (admRef.current == null) {
      const adm: ObserverAdmin = {
         reaction: null,
         onStoreChange: null,
         stateVersion: Symbol(),
         name,
         subscribe(onStoreChange: () => void) {
            abandonedRenders?.unregister(adm)
            adm.onStoreChange = onStoreChange
            if (adm.reaction == null) {
               // the registry disposed the reaction before mount, recreate it and
               // tick the version so the missed subscriptions trigger a re-render
               createReaction(adm)
               adm.stateVersion = Symbol()
            }
            return () => {
               adm.onStoreChange = null
               adm.reaction?.dispose()
               adm.reaction = null
            }
         },
         getSnapshot() {
            return adm.stateVersion
         },
      }
      admRef.current = adm
   }

   const adm = admRef.current
   let reaction = adm.reaction
   if (reaction == null) {
      reaction = createReaction(adm)
      abandonedRenders?.register(admRef, adm, adm)
   }

   useSyncExternalStore(adm.subscribe, adm.getSnapshot, adm.getSnapshot)

   // boxed so a component legitimately rendering null/undefined stays distinguishable
   // from a track() that never ran (holder object because flow analysis pins a
   // closure-assigned let to its initializer)
   const holder: { result: { value: T } | null; caught: unknown; didCatch: boolean } = {
      result: null,
      caught: null,
      didCatch: false,
   }
   reaction.track(() => {
      try {
         holder.result = { value: render() }
      } catch (e) {
         holder.didCatch = true
         holder.caught = e
      }
   })
   if (holder.didCatch) throw holder.caught
   if (holder.result == null) throw new Error('observer: reaction.track did not run the render')
   return holder.result.value
}

export const observer = <P extends object>(base: FunctionComponent<P>): NamedExoticComponent<P> => {
   const name = base.displayName ?? base.name
   const ObserverComponent: FunctionComponent<P> = (p: P) => useObserver(() => base(p), name)
   ObserverComponent.displayName = name
   return memo(ObserverComponent)
}
