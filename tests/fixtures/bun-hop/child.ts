// the bun side of the hop: a long running command, like serve
const hop: Record<string, unknown> = await import('src/cli/bunHop.ts')
const arm = hop['armHopChild']
if (typeof arm === 'function') arm({ intervalMs: 50 })
console.log(`child ${process.pid}`)
setInterval(() => {}, 1000)
