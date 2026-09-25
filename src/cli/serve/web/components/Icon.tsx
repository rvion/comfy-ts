// ONE inline svg icon set for the panel. No icon font, no dependency, no emoji:
// emoji render differently per platform (and a phone shows its own set), so an
// affordance drawn with one is not the same button on two devices.
// every path uses currentColor and 1em, so an icon inherits the text it sits in.
import type { ReactNode } from 'react'

export type IconName =
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
   | 'panel-off'
   | 'panel-bottom'
   | 'panel-side'
   | 'panel-left'
   | 'panel-corner'
   | 'swap'
   | 'plus'
   | 'copy-plus'
   | 'pen'
   | 'broom'
   | 'expand'
   | 'shrink'
   | 'power'
   | 'warn'
   | 'grip'
   | 'link'
   | 'unlink'
   | 'refresh'
   | 'terminal'
   | 'search'
   | 'history'
   | 'rows'
   | 'grid'
   | 'eye'
   | 'eye-off'
   | 'more'
   | 'text'
   | 'dot'
   | 'audio'
   | 'video'
   | 'workflow'
   | 'draft'

/** 24x24 viewBox paths, stroked (fill: none) unless the shape reads better solid */
const PATHS: Record<IconName, ReactNode> = {
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
   'panel-left': (
      <>
         <rect x="3" y="4" width="18" height="16" rx="2" />
         <path d="M10 4v16" />
         <rect x="4.5" y="5.5" width="4" height="13" fill="currentColor" stroke="none" opacity="0.85" />
      </>
   ),
   /* same frame as the other placements, filled in the corner it actually occupies — a pin
      said "sticky" while every sibling said WHERE */
   'panel-corner': (
      <>
         <rect x="3" y="4" width="18" height="16" rx="2" />
         <rect x="12.5" y="12.5" width="7" height="6" fill="currentColor" stroke="none" opacity="0.85" />
      </>
   ),
   swap: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
   plus: <path d="M12 5v14M5 12h14" />,
   'copy-plus': <path d="M9 9h10v10H9zM5 15V5h10M14 12v4M12 14h4" />,
   pen: <path d="M4 20h4L20 8l-4-4L4 16zM14 6l4 4" />,
   broom: <path d="M19 4l-7 7M9.5 8.5l6 6-5 5-6-6zM4.5 13.5L2 21l7.5-2.5" />,
   expand: <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />,
   shrink: <path d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5" />,
   power: <path d="M12 3v9M7.5 6.5a7 7 0 109 0" />,
   warn: <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />,
   link: (
      <path d="M10 14a4 4 0 015.7 0l2.6-2.6a4 4 0 10-5.7-5.7L11 7.3M14 10a4 4 0 01-5.7 0l-2.6 2.6a4 4 0 105.7 5.7L13 16.7" />
   ),
   unlink: <path d="M9 15l-1.6 1.6a4 4 0 01-5.7-5.7L3.3 9.3M15 9l1.6-1.6a4 4 0 015.7 5.7L20.7 14.7M4 4l16 16" />,
   grip: (
      <>
         <circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none" />
         <circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none" />
         <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
         <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
         <circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none" />
         <circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none" />
      </>
   ),
   refresh: <path d="M20 11a8 8 0 10-2 6M20 6v5h-5" />,
   terminal: <path d="M4 5h16v14H4zM7 9l3 3-3 3M13 15h4" />,
   text: <path d="M4 7h16M4 12h10M4 17h13" />,
   more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3.2} />,
   eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 110 6 3 3 0 010-6z" />,
   'eye-off': (
      <path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2" />
   ),
   rows: <path d="M4 5h16v6H4zM4 13h16v6H4z" />,
   grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
   search: <path d="M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L20 20" />,
   history: <path d="M4 12a8 8 0 102.3-5.6M4 4v4h4M12 8v4l3 2" />,
   dot: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
   audio: <path d="M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0" />,
   video: (
      <>
         <rect x="3" y="6" width="13" height="12" rx="2" />
         <path d="M16 10l5-3v10l-5-3z" />
      </>
   ),
   workflow: (
      <>
         <rect x="3" y="4" width="6" height="5" rx="1.2" />
         <rect x="15" y="4" width="6" height="5" rx="1.2" />
         <rect x="9" y="15" width="6" height="5" rx="1.2" />
         <path d="M6 9v2.5a1.5 1.5 0 001.5 1.5h9a1.5 1.5 0 001.5-1.5V9M12 13v2" />
      </>
   ),
   draft: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4" />,
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
