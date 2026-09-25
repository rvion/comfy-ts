// one-command release: preflight → bun publish → git tag vX.Y.Z → push → GitHub release
// the CHANGELOG.md section for the version becomes the release notes; prepublishOnly runs the gate
// resumable: every step checks its own result first, so a run that died anywhere (the version on
// npm without its tag, or a tag and a GitHub release for a version npm never received) finishes
// the same version. `bun publish` can exit 0 without the registry having the version: the
// release waits until npm lists it, and stops before any tag when it does not
// usage: bun scripts/release.ts [--dry-run] [--allow-dirty]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

/** true once the registry lists `version`, false after `tries` reads that did not */
export async function waitForVersion(p: {
   version: string
   tries: number
   wait: () => Promise<void>
   versions: () => Promise<Record<string, unknown> | undefined>
}): Promise<boolean> {
   for (let i = 0; i < p.tries; i++) {
      if (i > 0) await p.wait()
      if ((await p.versions())?.[p.version] != null) return true
   }
   return false
}

async function registryVersions(name: string): Promise<Record<string, unknown> | undefined> {
   const res = await fetch(`https://registry.npmjs.org/${name}?t=${Date.now()}`, {
      headers: { 'cache-control': 'no-cache' },
   })
   if (!res.ok) return undefined
   return ((await res.json()) as { versions?: Record<string, unknown> }).versions
}

export function extractChangelogSection(p: { changelog: string; version: string }): string {
   const lines = p.changelog.split('\n')
   const start = lines.findIndex((l) => l.trim() === `## ${p.version}`)
   if (start === -1) throw new Error(`[release] 🔴 CHANGELOG.md has no "## ${p.version}" section`)
   let end = lines.length
   for (let i = start + 1; i < lines.length; i++) {
      if (lines[i]?.startsWith('## ')) {
         end = i
         break
      }
   }
   const body = lines
      .slice(start + 1, end)
      .join('\n')
      .trim()
   if (body === '') throw new Error(`[release] 🔴 CHANGELOG.md section "## ${p.version}" is empty`)
   return body
}

function run(p: { cmd: string[]; capture?: boolean; env?: Record<string, string> }): string {
   const res = Bun.spawnSync(p.cmd, {
      stdout: p.capture ? 'pipe' : 'inherit',
      stderr: p.capture ? 'pipe' : 'inherit',
      env: p.env == null ? undefined : { ...process.env, ...p.env },
   })
   if (res.exitCode !== 0) {
      const tail = p.capture ? `\n${res.stdout?.toString() ?? ''}${res.stderr?.toString() ?? ''}` : ''
      throw new Error(`[release] 🔴 command failed (${res.exitCode}): ${p.cmd.join(' ')}${tail}`)
   }
   return p.capture ? (res.stdout?.toString() ?? '') : ''
}

async function main(): Promise<void> {
   const dryRun = process.argv.includes('--dry-run')
   const allowDirty = process.argv.includes('--allow-dirty')

   const pkg = (await Bun.file('package.json').json()) as { name: string; version: string }
   const version = pkg.version
   const tag = `v${version}`
   console.log(`[release] 📦 ${pkg.name}@${version} (tag ${tag})${dryRun ? ' DRY RUN' : ''}`)

   // preflight, all loud, nothing touched yet
   const branch = run({ cmd: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], capture: true }).trim()
   if (branch !== 'main') throw new Error(`[release] 🔴 releases ship from main, current branch is ${branch}`)

   const dirty = run({ cmd: ['git', 'status', '--porcelain'], capture: true }).trim()
   if (dirty !== '' && !allowDirty)
      throw new Error(`[release] 🔴 working tree not clean (use --allow-dirty to override):\n${dirty}`)
   if (dirty !== '' && allowDirty)
      console.log(
         `[release] 🟡 dirty tree allowed by flag. The npm tarball will pack these uncommitted changes but the tag will NOT contain them:\n${dirty}`,
      )

   const regRes = await fetch(`https://registry.npmjs.org/${pkg.name}`)
   if (!regRes.ok) throw new Error(`[release] 🔴 npm registry lookup failed: ${regRes.status} ${regRes.statusText}`)
   const registry = (await regRes.json()) as { versions?: Record<string, unknown> }
   const alreadyPublished = registry.versions?.[version] != null

   const tagExists = Bun.spawnSync(['git', 'rev-parse', '--quiet', '--verify', `refs/tags/${tag}`]).exitCode === 0
   if (alreadyPublished && tagExists)
      throw new Error(
         `[release] 🔴 ${pkg.name}@${version} is fully released (npm + tag ${tag}); bump package.json first`,
      )
   if (alreadyPublished)
      console.log(`[release] 🟡 ${version} already on npm but ${tag} missing: resuming after publish`)
   if (tagExists && !alreadyPublished)
      console.log(`[release] 🟡 ${tag} exists but npm lacks ${version}: publishing, then finishing what is missing`)

   const notes = extractChangelogSection({ changelog: await Bun.file('CHANGELOG.md').text(), version })
   console.log(`[release] 📝 notes: ${notes.split('\n').length} lines from CHANGELOG.md "## ${version}"`)

   run({ cmd: ['gh', 'auth', 'status'], capture: true })
   const token = run({ cmd: ['rv-secret', 'get', 'rv/npm/token'], capture: true }).trim()
   if (token === '') throw new Error('[release] 🔴 rv-secret returned an empty npm token')

   if (dryRun) {
      const steps = alreadyPublished ? `tag ${tag} → push → gh release` : `bun publish → tag ${tag} → push → gh release`
      console.log(`[release] ✅ dry run ok (branch, tree, registry, changelog, gh auth, token). Would: ${steps}`)
      return
   }

   const workDir = mkdtempSync(join(tmpdir(), 'comfy-ts-release-'))
   try {
      if (!alreadyPublished) {
         // bun's packer is the one tests/npm-tarball.test.ts guards: the tested tarball is the published one
         run({ cmd: ['bun', 'publish'], env: { NPM_CONFIG_TOKEN: token } })
         const listed = await waitForVersion({
            version,
            // npm took about 7 minutes to list 2.13.0 and 2.14.0 after a publish it had accepted
            tries: 60,
            wait: () => Bun.sleep(10_000),
            versions: () => registryVersions(pkg.name),
         })
         if (!listed)
            throw new Error(
               `[release] 🔴 bun publish exited 0 but npm does not list ${pkg.name}@${version} after 10 minutes. Nothing was tagged. A publish npm accepted can still be pending: rerun later, it resumes once the version is listed (a 409 on a second bun publish means npm has it)`,
            )
      }

      if (!tagExists) run({ cmd: ['git', 'tag', '-a', tag, '-m', `${pkg.name} ${version}`] })
      run({ cmd: ['git', 'push'] })
      run({ cmd: ['git', 'push', 'origin', tag] })

      const notesFile = join(workDir, 'notes.md')
      writeFileSync(notesFile, notes)
      const releaseExists =
         Bun.spawnSync(['gh', 'release', 'view', tag], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0
      if (!releaseExists)
         run({
            cmd: [
               'gh',
               'release',
               'create',
               tag,
               '--verify-tag',
               '--title',
               `${pkg.name} ${version}`,
               '--notes-file',
               notesFile,
            ],
         })
      console.log(`[release] ✅ ${pkg.name}@${version} published, tagged ${tag}, GitHub release live`)
   } finally {
      rmSync(workDir, { recursive: true, force: true })
   }
}

if (import.meta.main) await main()
