// mirror the official ComfyUI template/blueprint corpora into .comfy-ts/templates/<source>/
// one codeload tarball per repo, wipe-and-rewrite per source, re-run any time
// usage: bun scripts/fetch-templates.ts
import { mkdirSync, mkdtempSync, readdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

interface SourceSpec {
   /** folder name under .comfy-ts/templates/ */
   name: string
   /** dir inside the extracted repo to copy from, recursively */
   repoDir: string
   /** repo-root manifest files to copy alongside */
   rootFiles: string[]
   /** kept extensions; everything else (thumbnails, previews…) is counted as skipped */
   keepExt: string[]
}

interface RepoSpec {
   repo: string
   branch: string
   sources: SourceSpec[]
}

const REPOS: RepoSpec[] = [
   {
      repo: 'Comfy-Org/workflow_templates',
      branch: 'main',
      sources: [
         { name: 'workflow-templates', repoDir: 'templates', rootFiles: ['bundles.json'], keepExt: ['.json'] },
         {
            name: 'workflow-templates-blueprints',
            repoDir: 'blueprints',
            rootFiles: ['blueprints_bundles.json'],
            keepExt: ['.json'],
         },
      ],
   },
   {
      repo: 'Comfy-Org/ComfyUI',
      branch: 'master',
      sources: [
         { name: 'comfyui-blueprints', repoDir: 'blueprints', rootFiles: [], keepExt: ['.json', '.glsl', '.frag'] },
      ],
   },
]

async function downloadAndExtract(p: { repo: string; branch: string; workDir: string }): Promise<string> {
   const url = `https://codeload.github.com/${p.repo}/tar.gz/refs/heads/${p.branch}`
   console.log(`[templates] ⏬ ${url}`)
   const res = await fetch(url)
   if (!res.ok) throw new Error(`[templates] 🔴 download failed (${res.status} ${res.statusText}): ${url}`)
   const bytes = new Uint8Array(await res.arrayBuffer())
   const slug = p.repo.replace('/', '-')
   const tarPath = join(p.workDir, `${slug}.tar.gz`)
   writeFileSync(tarPath, bytes)
   const extractDir = join(p.workDir, slug)
   mkdirSync(extractDir, { recursive: true })
   const tar = Bun.spawnSync(['tar', '-xzf', tarPath, '-C', extractDir])
   if (tar.exitCode !== 0) throw new Error(`[templates] 🔴 tar extract failed for ${tarPath}: ${tar.stderr.toString()}`)
   const tops = readdirSync(extractDir)
   const top = tops[0]
   if (top == null || tops.length !== 1)
      throw new Error(`[templates] 🔴 expected exactly one top-level dir in ${extractDir}, got [${tops.join(', ')}]`)
   return join(extractDir, top)
}

function copyTree(p: { from: string; to: string; keepExt: string[] }): { kept: number; skipped: number } {
   let kept = 0
   let skipped = 0
   for (const entry of readdirSync(p.from, { withFileTypes: true })) {
      const src = join(p.from, entry.name)
      if (entry.isDirectory()) {
         const sub = copyTree({ from: src, to: join(p.to, entry.name), keepExt: p.keepExt })
         kept += sub.kept
         skipped += sub.skipped
         continue
      }
      if (!p.keepExt.some((ext) => entry.name.endsWith(ext))) {
         skipped++
         continue
      }
      mkdirSync(p.to, { recursive: true })
      copyFileSync(src, join(p.to, entry.name))
      kept++
   }
   return { kept, skipped }
}

const destRoot = join(process.cwd(), '.comfy-ts', 'templates')
const workDir = mkdtempSync(join(tmpdir(), 'comfy-ts-templates-'))
const summary: { name: string; kept: number; skipped: number }[] = []

try {
   for (const repoSpec of REPOS) {
      const repoRoot = await downloadAndExtract({ repo: repoSpec.repo, branch: repoSpec.branch, workDir })
      for (const source of repoSpec.sources) {
         const dest = join(destRoot, source.name)
         rmSync(dest, { recursive: true, force: true })
         const counts = copyTree({ from: join(repoRoot, source.repoDir), to: dest, keepExt: source.keepExt })
         mkdirSync(dest, { recursive: true })
         for (const rootFile of source.rootFiles) {
            copyFileSync(join(repoRoot, rootFile), join(dest, rootFile))
            counts.kept++
         }
         summary.push({ name: source.name, kept: counts.kept, skipped: counts.skipped })
      }
   }
} finally {
   rmSync(workDir, { recursive: true, force: true })
}

console.log(`[templates] 🟢 done → ${destRoot}`)
for (const row of summary) {
   console.log(`[templates]    ${row.name}: ${row.kept} files (${row.skipped} image/asset files skipped for now)`)
}
