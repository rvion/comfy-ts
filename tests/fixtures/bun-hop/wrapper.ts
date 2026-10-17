// the node side of the hop, run under bun here: it re-execs child.ts the way the bin re-execs the cli
import { hopToBun } from 'src/cli/bunHop.ts'

const res = await hopToBun([new URL('./child.ts', import.meta.url).pathname])
process.exitCode = 'code' in res ? res.code : 1
