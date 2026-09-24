import { spawnSync } from 'node:child_process'

/** the tarball file list as bun packs it: same list as npm on this repo (npm-tarball-parity.test.ts pins that) */
export function bunPackList(): string[] {
   const res = spawnSync('bun', ['pm', 'pack', '--dry-run'], { encoding: 'utf8' })
   if (res.status !== 0) throw new Error(`bun pm pack failed: ${res.stderr}`)
   const paths = res.stdout
      .split('\n')
      .map((l) => /^packed \S+ (.+)$/.exec(l)?.[1])
      .filter((p): p is string => p != null)
   if (paths.length === 0) throw new Error(`bun pm pack listed no file:\n${res.stdout}`)
   return paths
}

/** the tarball file list as npm packs it: what `npm publish` actually ships */
export function npmPackList(): string[] {
   const res = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
   if (res.status !== 0) throw new Error(`npm pack failed: ${res.stderr}`)
   const parsed: { files?: { path: string }[] }[] = JSON.parse(res.stdout)
   const files = parsed[0]?.files
   if (files == null) throw new Error('npm pack --json returned no file list')
   return files.map((f) => f.path)
}
