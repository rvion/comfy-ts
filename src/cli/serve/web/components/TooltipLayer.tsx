// ONE tooltip for the whole panel: any element carrying `data-tip` gets it, so no component
// wires anything. floating-ui places it in a portal, flips and shifts it at the screen edges,
// and it never lives inside a scroll box, where a pseudo-element tooltip got clipped and even
// made the box scroll. Instant, like the css tooltips it replaces: a delay was never wanted.
// `data-tip-side="right"` puts it beside the element instead of under it
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from '@floating-ui/react'
import { useEffect, useState, type ReactNode } from 'react'

export function TooltipLayer(): ReactNode {
   const [tip, setTip] = useState<{ el: Element; text: string } | null>(null)
   const { refs, floatingStyles } = useFloating({
      placement: tip?.el.getAttribute('data-tip-side') === 'right' ? 'right' : 'bottom-start',
      middleware: [offset(6), flip(), shift({ padding: 8 })],
      whileElementsMounted: autoUpdate,
      elements: { reference: tip?.el ?? null },
   })
   useEffect(() => {
      const over = (e: PointerEvent): void => {
         // a finger has no hover: a tip on touch would stay stuck over what you just tapped
         if (e.pointerType === 'touch') return
         const target = e.target
         const el = target instanceof Element ? target.closest('[data-tip]') : null
         const text = el?.getAttribute('data-tip') ?? ''
         setTip((cur) => (el == null || text === '' ? null : cur?.el === el && cur.text === text ? cur : { el, text }))
      }
      const hide = (): void => setTip(null)
      document.addEventListener('pointerover', over)
      document.addEventListener('pointerdown', hide)
      document.addEventListener('keydown', hide)
      window.addEventListener('scroll', hide, true)
      return () => {
         document.removeEventListener('pointerover', over)
         document.removeEventListener('pointerdown', hide)
         document.removeEventListener('keydown', hide)
         window.removeEventListener('scroll', hide, true)
      }
   }, [])
   if (tip == null) return null
   return (
      <FloatingPortal>
         <div ref={refs.setFloating} style={floatingStyles} className="tooltip" role="tooltip">
            {tip.text}
         </div>
      </FloatingPortal>
   )
}
