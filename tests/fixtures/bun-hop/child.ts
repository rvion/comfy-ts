// the bun side of the hop: a long running command, like serve
import { armHopChild } from 'src/cli/bunHop.ts'

armHopChild({ intervalMs: 50 })
console.log(`child ${process.pid}`)
setInterval(() => {}, 1000)
