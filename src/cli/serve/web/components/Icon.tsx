// ONE inline svg icon set for the panel. No icon font, no dependency, no emoji:
// emoji render differently per platform (and a phone shows its own set), so an
// affordance drawn with one is not the same button on two devices.
// Every path uses currentColor and 1em, so an icon inherits the text it sits in.
import type { ReactNode } from 'react'

export type IconName =
   | 'menu'
   | 'close'
   | 'trash'
   | 'copy'
   | 'external'
   | 'dice'
   | 'image'
   | 'tag'
   | 'sparkle'
   | 'play'
   | 'pause'
   | 'save'
   | 'ghost'
   | 'pin'
   | 'panel-off'
   | 'panel-bottom'
   | 'panel-side'
   | 'swap'
   | 'plus'
   | 'copy-plus'
   | 'dot'

/** 24x24 viewBox paths, stroked (fill: none) unless the shape reads better solid */
const PATHS: Record<IconName, ReactNode> = {
   menu: <path d="M4 7h16M4 12h16M4 17h16" />,
   close: <path d="M6 6l12 12M18 6L6 18" />,
   trash: <path d="M4 7h16M10 7V5h4v2M6 7l1 12h10l1-12M10 11v5M14 11v5" />,
   copy: <path d="M9 9h10v10H9zM5 15V5h10" />,
   external: <path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" />,
   dice: (
      <>
         <rect x="4" y="4" width="16" height="16" rx="3" />
         <circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none" />
         <circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none" />
         <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      </>
   ),
   image: (
      <>
         <rect x="3" y="5" width="18" height="14" rx="2" />
         <circle cx="8.5" cy="10" r="1.5" />
         <path d="M4 17l5-5 4 4 3-2 4 4" />
      </>
   ),
   tag: (
      <>
         <path d="M4 11V4h7l9 9-7 7-9-9z" />
         <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
      </>
   ),
   sparkle: (
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
   ),
   play: <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />,
   pause: <path d="M8 5v14M16 5v14" />,
   save: <path d="M5 4h11l3 3v13H5zM8 4v6h7V4M8 20v-6h8v6" />,
   ghost: <path d="M5 20V10a7 7 0 0114 0v10l-2.3-2-2.4 2-2.3-2-2.4 2zM9.5 10h.01M14.5 10h.01" />,
   pin: <path d="M9 3h6l-1 6 4 4H6l4-4z M12 13v8" />,
   'panel-off': (
      <>
         <rect x="3" y="4" width="18" height="16" rx="2" />
         <path d="M4 5l16 14" />
      </>
   ),
   'panel-bottom': (
      <>
         <rect x="3" y="4" width="18" height="16" rx="2" />
         <path d="M3 14h18" />
         <rect x="4.5" y="15.5" width="15" height="3" fill="currentColor" stroke="none" opacity="0.85" />
      </>
   ),
   'panel-side': (
      <>
         <rect x="3" y="4" width="18" height="16" rx="2" />
         <path d="M14 4v16" />
         <rect x="15.5" y="5.5" width="4" height="13" fill="currentColor" stroke="none" opacity="0.85" />
      </>
   ),
   swap: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
   plus: <path d="M12 5v14M5 12h14" />,
   'copy-plus': <path d="M9 9h10v10H9zM5 15V5h10M14 12v4M12 14h4" />,
   dot: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
}

/** `size` is a multiplier of the surrounding font size, so icons scale with their button */
export function Icon(p: { name: IconName; size?: number; title?: string }): ReactNode {
   return (
      <svg
         className="icon"
         viewBox="0 0 24 24"
         width={`${p.size ?? 1.15}em`}
         height={`${p.size ?? 1.15}em`}
         fill="none"
         stroke="currentColor"
         strokeWidth={1.8}
         strokeLinecap="round"
         strokeLinejoin="round"
         aria-hidden={p.title == null}
         role={p.title == null ? undefined : 'img'}
      >
         {p.title == null ? null : <title>{p.title}</title>}
         {PATHS[p.name]}
      </svg>
   )
}
