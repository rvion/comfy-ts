// comfy-ts's parts of shipkit's social desk: the headings a release stages. Each release becomes one draft with a
// post for the Discord channel #releases (members and other servers follow it) and one for X; nothing posts by itself
import { social } from 'rvlib-shipkit/src/shipkit-files.ts'

export default social({
    release: { headings: [{ id: 'discord', place: 'releases' }, { id: 'x' }] },
})
