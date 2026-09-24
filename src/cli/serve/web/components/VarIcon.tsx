// the icons a WORKFLOW gives its vars and their choices (VarUi.icon, VarUi.options[x].icon)
import type { ReactNode } from 'react'

/** a workflow's own icon for a var: a 24×24 path drawn in the icon color, or a whole svg. A
 * whole svg goes through an <img> data url, so markup from a workflow never reaches the dom */
export function VarIcon(p: { icon: string; color: string | undefined }): ReactNode {
   if (p.icon.trimStart().startsWith('<svg'))
      return <img className="var-icon" alt="" src={`data:image/svg+xml;utf8,${encodeURIComponent(p.icon)}`} />
   return (
      <svg
         className="var-icon"
         viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         strokeWidth={2}
         strokeLinecap="round"
         strokeLinejoin="round"
         style={p.color == null ? undefined : { color: p.color }}
         aria-hidden="true"
      >
         <path d={p.icon} />
      </svg>
   )
}
