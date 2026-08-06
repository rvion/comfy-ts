// one-command release: preflight → npm publish → git tag vX.Y.Z → push → GitHub release
// the CHANGELOG.md section for the version becomes the release notes; prepublishOnly runs the gate
// resumable: if the version is on npm but the tag is missing (a past run died mid-pipeline),
// publish is skipped and the tag/push/release steps run for the same version
// usage: bun scripts/release.ts [--dry-run] [--allow-dirty]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

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

function run(p: { cmd: string[]; capture?: boolean }): string {
   const res = Bun.spawnSync(p.cmd, {
      stdout: p.capture ? 'pipe' : 'inherit',
      stderr: p.capture ? 'pipe' : 'inherit',
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

   const notes = extractChangelogSection({ changelog: await Bun.file('CHANGELOG.md').text(), version })
   console.log(`[release] 📝 notes: ${notes.split('\n').length} lines from CHANGELOG.md "## ${version}"`)

   run({ cmd: ['gh', 'auth', 'status'], capture: true })
   const token = run({ cmd: ['rv-secret', 'get', 'rv/npm/token'], capture: true }).trim()
   if (token === '') throw new Error('[release] 🔴 rv-secret returned an empty npm token')

   if (dryRun) {
      const steps = alreadyPublished ? `tag ${tag} → push → gh release` : `npm publish → tag ${tag} → push → gh release`
      console.log(`[release] ✅ dry run ok (branch, tree, registry, changelog, gh auth, token). Would: ${steps}`)
      return
   }

   const workDir = mkdtempSync(join(tmpdir(), 'comfy-ts-release-'))
   try {
      if (!alreadyPublished) {
         const npmrc = join(workDir, 'npmrc')
         writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 })
         run({ cmd: ['npm', 'publish', '--userconfig', npmrc] })
      }

      run({ cmd: ['git', 'tag', '-a', tag, '-m', `${pkg.name} ${version}`] })
      run({ cmd: ['git', 'push'] })
      run({ cmd: ['git', 'push', 'origin', tag] })

      const notesFile = join(workDir, 'notes.md')
      writeFileSync(notesFile, notes)
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
