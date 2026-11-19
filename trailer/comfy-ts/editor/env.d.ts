// the one global the hosts take reads: process.env, as bun and node type it
declare const process: { env: Record<string, string | undefined> }
