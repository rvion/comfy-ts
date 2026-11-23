// output widgets: a module names a BUILT-IN web panel widget and maps its roles to output tags
// (the `tag` of a save node's metadata). The panel renders it over the run's tagged images; the
// CLI and the TUI ignore it. Pure data: the web bundle imports this file.

/** the maps a relight widget reads, each the tag of one output image */
export type RelightRoles = {
   /** the photo itself; the base colour when no albedo is given */
   image: string
   /** near = white; places each pixel in 3D and casts the shadows */
   depth?: string
   /** OpenGL convention (green up) */
   normal?: string
   albedo?: string
   /** white = rough */
   roughness?: string
   /** white = metal */
   metalness?: string
   /** the non diffuse part of the light (reflections, highlights) */
   specular?: string
}

export type RelightWidget = { kind: 'relight'; title?: string; roles: RelightRoles }

export type OutputWidget = RelightWidget
export type OutputWidgetKind = OutputWidget['kind']

export const widget = {
   /** a point light moved over the image in 3D: left/right, up/down, nearer/farther */
   relight(roles: RelightRoles, opts: { title?: string } = {}): RelightWidget {
      if (roles.depth == null && roles.normal == null)
         throw new Error(
            'widget.relight needs a `depth` or a `normal` role: without either there is no surface to light',
         )
      return { kind: 'relight', roles, ...(opts.title != null ? { title: opts.title } : {}) }
   },
}

/** the roles of a widget whose tag one of the images carries, as role → index in `images` */
export function resolveWidgetRoles(w: OutputWidget, images: { tags?: string[] }[]): Map<string, number> {
   const out = new Map<string, number>()
   for (const [role, tag] of Object.entries(w.roles)) {
      if (typeof tag !== 'string') continue
      const ix = images.findIndex((img) => img.tags?.includes(tag) === true)
      if (ix >= 0) out.set(role, ix)
   }
   return out
}
