import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'pathe'

// NO HARD WRAPS. One line per paragraph and per bullet,
// however long. Never cut a sentence with a newline for line width — editors
// soft-wrap, renderers reflow, and grep needs the phrase whole. Code fences,
// tables and frontmatter keep their own line structure.
// This test is the guard: a remembered promise would decay in one session.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SKIP_DIRS = new Set([
   'node_modules',
   'dist',
   'tmp',
   '.tmp',
   '.git',
   '.comfy-ts',
   '.shipkit/journal',
   '.shipkit/private',
   '.shipkit/reflections',
   '.shipkit/social',
   'external-docs', // upstream mirrors are DATA, never restyled
])

/** SKIP_DIRS holds bare names AND root-relative paths (`.shipkit/journal`) */
export function markdownFiles(dir: string, out: string[] = [], root = dir): string[] {
   for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (SKIP_DIRS.has(name) || SKIP_DIRS.has(relative(root, abs))) continue
      if (statSync(abs).isDirectory()) markdownFiles(abs, out, root)
      else if (name.endsWith('.md')) out.push(abs)
   }
   return out
}

/** a line that starts its own block: it can never be the tail of a wrap */
function startsOwnBlock(line: string): boolean {
   const s = line.trim()
   if (s === '') return true
   return (
      /^\s{0,3}#{1,6}\s/.test(line) || // heading
      /^\s*([-*+]|\d+[.)])\s/.test(line) || // list item
      /^\s*\|/.test(line) || // table row
      /^\s*>/.test(s) || // blockquote
      /^\s*</.test(line) || // html
      /^\s*@\S/.test(line) || // @include manifest line
      /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) // thematic break
   )
}

/** 1-indexed line numbers where a sentence was cut for width */
export function findHardWraps(markdown: string): number[] {
   const lines = markdown.split('\n')
   const hits: number[] = []
   let inFence = false
   let fenceTok = ''
   let inFrontmatter = lines[0]?.trim() === '---'
   for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (inFrontmatter) {
         if (i > 0 && line.trim() === '---') inFrontmatter = false
         continue
      }
      const fence = /^\s*(```|~~~)/.exec(line)
      if (fence?.[1] != null) {
         if (!inFence) {
            inFence = true
            fenceTok = fence[1]
         } else if (fence[1] === fenceTok) inFence = false
         continue
      }
      if (inFence || startsOwnBlock(line)) continue
      // an indented code block starts after a blank line
      if ((lines[i - 1] ?? '').trim() === '' && line.startsWith('    ')) continue
      const prev = lines[i - 1] ?? ''
      if (prev.trim() === '') continue
      if (/^\s*(```|~~~)/.test(prev) || /^\s{0,3}#{1,6}\s/.test(prev) || /^\s*\|/.test(prev)) continue
      hits.push(i + 1)
   }
   return hits
}

describe('markdown carries no hard wraps', () => {
   it('detects a sentence cut for line width, and leaves real structure alone', () => {
      expect(findHardWraps('a sentence cut\nfor width here\n')).toEqual([2])
      expect(findHardWraps('- a bullet cut\n  for width\n')).toEqual([2])
      expect(findHardWraps('one long line, uncut\n\nanother one\n')).toEqual([])
      expect(findHardWraps('```\ncode\nstays\n```\n')).toEqual([])
      expect(findHardWraps('| a | b |\n| - | - |\n| 1 | 2 |\n')).toEqual([])
      expect(findHardWraps('# heading\ntext under it\n')).toEqual([])
   })

   it('skips the nested private dirs, not only the top level names', () => {
      // why we think it is actually a bug, and not just meaning spec should change: SKIP_DIRS lists '.shipkit/journal' and '.shipkit/social' on purpose, yet they were matched against a bare dir name and never skipped, so the guard failed on gitignored journals and on social posts whose line breaks are the content
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-md-skip-'))
      for (const dir of ['.shipkit/journal', '.shipkit/social/x', 'docs'])
         mkdirSync(join(root, dir), { recursive: true })
      writeFileSync(join(root, '.shipkit/journal/changelog.md'), 'cut\nhere\n')
      writeFileSync(join(root, '.shipkit/social/x/post.md'), 'cut\nhere\n')
      writeFileSync(join(root, 'docs/page.md'), 'kept\n')
      expect(markdownFiles(root).map((abs) => relative(root, abs))).toEqual(['docs/page.md'])
   })

   it('every markdown file in the repo is one line per paragraph and per bullet', () => {
      const offenders: string[] = []
      for (const abs of markdownFiles(repoRoot)) {
         const hits = findHardWraps(readFileSync(abs, 'utf8'))
         if (hits.length > 0) offenders.push(`${relative(repoRoot, abs)}: line(s) ${hits.slice(0, 8).join(', ')}`)
      }
      expect(offenders, `hard-wrapped markdown (join those lines):\n${offenders.join('\n')}`).toEqual([])
   })
})
