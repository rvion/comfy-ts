// results, newest first: images straight off /outputs/, seeds + timing caption
import { observer } from 'mobx-react-lite'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export const Gallery = observer(function Gallery(p: { st: WebSt }) {
   if (p.st.run.results.length === 0) return null
   return (
      <div className="gallery">
         {p.st.run.results.map((r) => (
            <div key={r.promptId} className="run-card">
               <div className="meta">
                  {r.at} · {r.module}/{r.draft} · {(r.durationMs / 1000).toFixed(1)}s
                  {Object.entries(r.seeds).map(([k, seed]) => ` · ${k}: ${seed}`)}
               </div>
               <div className="imgs">
                  {r.images.map((img) =>
                     img.url != null ? (
                        <a key={img.filename} href={img.url} target="_blank" rel="noreferrer">
                           <img src={img.url} alt={img.filename} title={img.filename} />
                        </a>
                     ) : (
                        <div key={img.filename} className="noimg">
                           {img.filename} (not saved locally — no preview)
                        </div>
                     ),
                  )}
                  {r.images.length === 0 ? <div className="noimg">no image outputs</div> : null}
               </div>
            </div>
         ))}
      </div>
   )
})
