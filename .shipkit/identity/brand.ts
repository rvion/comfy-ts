// the identity of comfy-ts: the pillow icon (icon.png beside this file) on the navy ground of its trailer, the amber
// accent of its titles. The release card of each release post is drawn from it (`sk social release-card`)
import { image, type Brand } from 'rvlib-shipkit'

const brand: Brand = {
    name: 'comfy-ts',
    tagline: 'your ComfyUI, typed',
    palette: { bg: '#0b1220', accent: '#ffb020', ink: '#eaf1ff' },
    mark: image(new URL('./icon.png', import.meta.url)),
}
export default brand
