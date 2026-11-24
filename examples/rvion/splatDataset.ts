// the training set of a splat, picked from a full fly-through export (flythroughColmap.ts with every 1): one
// fixed held-out split for every variant, so variants are scored on the same frames. The base set is the
// one the first splat trained on (every 4th frame); every 8th of it is held out, and every 8th (shifted) is
// the training check. A variant then picks its training frames: denser (every 1 or 2), far enough from
// any held-out frame that it never trains on a near copy of one, and above a camera match score.
//
// run:  bun examples/rvion/splatDataset.ts <full colmap dir> <out dir> [--every n] [--gap n] [--min-score s] [--clips 0,1,2]
// writes <out>/sparse/0/{cameras,images,points3D}.txt (images.txt: the training frames only) and <out>/split.json
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'

export type Frame = { clip: number; frame: number; score: number; name: string }

/** the frames of a full export, in time order, with their camera match (retime.json) */
export function exportFrames(colmapDir: string): Frame[] {
   const timing = JSON.parse(readFileSync(join(colmapDir, 'retime.json'), 'utf8')) as { clip: number; frame: number; score: number }[]
   return timing.map((t) => ({ ...t, name: `c${t.clip}-f${String(t.frame).padStart(3, '0')}.png` }))
}

export type Split = { heldout: string[]; trainCheck: string[]; train: string[] }

export type SplitRule = {
   /** a training frame every n frames of each clip */
   every: number
   /** no training frame within this many frames of a held-out one, in its clip */
   gap: number
   /** no training frame whose camera match is under this */
   minScore: number
   /** the clips that train; all when absent */
   clips?: number[]
}

/** the base set is every 4th frame (a later clip's frame 0 is the last clip's end, kept once) */
const inBase = (f: Frame) => f.frame % 4 === 0 && (f.clip === 0 || f.frame > 0)

export function splitFrames(frames: Frame[], rule: SplitRule): Split {
   const base = frames.filter(inBase)
   const heldout = base.filter((_, i) => i % 8 === 4)
   const held = new Set(heldout.map((f) => f.name))
   const near = (f: Frame) => heldout.some((h) => h.clip === f.clip && Math.abs(h.frame - f.frame) <= rule.gap)
   const train = frames.filter(
      (f) =>
         !held.has(f.name) &&
         f.frame % rule.every === 0 &&
         (f.clip === 0 || f.frame > 0) &&
         !near(f) &&
         f.score >= rule.minScore &&
         (rule.clips == null || rule.clips.includes(f.clip)),
   )
   const trained = new Set(train.map((f) => f.name))
   const trainCheck = base.filter((f, i) => i % 8 === 0 && trained.has(f.name))
   return { heldout: heldout.map((f) => f.name), trainCheck: trainCheck.map((f) => f.name), train: train.map((f) => f.name) }
}

if (import.meta.main) {
   const args = process.argv.slice(2)
   const flag = (name: string) => {
      const i = args.indexOf(name)
      return i < 0 ? undefined : args.splice(i, 2)[1]
   }
   const every = Number(flag('--every') ?? 4)
   const gap = Number(flag('--gap') ?? 3)
   const minScore = Number(flag('--min-score') ?? Number.NEGATIVE_INFINITY)
   const clips = flag('--clips')?.split(',').map(Number)
   const [full, out] = args
   if (full == null || out == null) throw new Error('usage: bun examples/rvion/splatDataset.ts <full colmap dir> <out dir> [--every n] [--gap n] [--min-score s] [--clips 0,1,2]')
   const split = splitFrames(exportFrames(full), { every, gap, minScore, clips })
   const sparse = join(out, 'sparse', '0')
   mkdirSync(sparse, { recursive: true })
   copyFileSync(join(full, 'sparse', '0', 'cameras.txt'), join(sparse, 'cameras.txt'))
   copyFileSync(join(full, 'sparse', '0', 'points3D.txt'), join(sparse, 'points3D.txt'))
   const keep = new Set(split.train)
   const lines = readFileSync(join(full, 'sparse', '0', 'images.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('#') || keep.has(l.trim().split(/\s+/)[9] ?? ''))
   // COLMAP pairs each image line with a line of its 2D points: none here, so an empty one
   writeFileSync(join(sparse, 'images.txt'), `${lines.flatMap((l) => (l.startsWith('#') ? [l] : [l, ''])).join('\n')}\n`)
   writeFileSync(join(out, 'split.json'), JSON.stringify(split))
   console.log(`🟢 ${split.train.length} training frames, ${split.heldout.length} held out, ${split.trainCheck.length} training checks: ${out}`)
}
