// the output widget REGISTRY: a widget kind a module names → the component that draws it over a
// run's tagged images. Built into the panel bundle; a module ships no browser code.
import type { GeneratedImage } from 'src/cli/serve/web/api.ts'
import { RelightWidgetView } from 'src/cli/serve/web/widgets/RelightWidget.tsx'
import type { OutputWidget } from 'src/vars/outputWidgets.ts'

export function OutputWidgets(p: { widgets: OutputWidget[] | undefined; images: GeneratedImage[] }) {
   if (p.widgets == null || p.widgets.length === 0) return null
   return (
      <div className="output-widgets">
         {p.widgets.map((w, ix) => {
            switch (w.kind) {
               case 'relight':
                  return <RelightWidgetView key={ix} widget={w} images={p.images} />
            }
         })}
      </div>
   )
}
