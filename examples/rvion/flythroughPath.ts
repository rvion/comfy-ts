// the camera paths of 19-flythrough, pure numbers: no host, so a test or a script loads them alone

/** one camera of the walk, in the render's world (three.js: y up, the picture's camera at the
 * origin looking down -z, as MoGe's mesh is placed) */
export type PathCamera = { position: [number, number, number]; target: [number, number, number] }

/**
 * the walk: `distance` metres forward with an eased speed (still at both ends, so frame 0 is the
 * picture), the heading turning `turn` degrees (positive = right) and the eye rising `rise` metres
 * on the same ease. The camera always looks along its heading, one metre ahead, `pitch` degrees down
 */
export function walkPath(p: { frames: number; distance: number; turn: number; rise: number; pitch?: number }): PathCamera[] {
   const down = ((p.pitch ?? 0) * Math.PI) / 180
   const ease = (t: number) => t * t * (3 - 2 * t)
   const out: PathCamera[] = []
   let x = 0
   let z = 0
   let prev = 0
   for (let i = 0; i < p.frames; i++) {
      const s = p.frames === 1 ? 0 : ease(i / (p.frames - 1))
      const heading = (p.turn * s * Math.PI) / 180
      // integrate along the heading at the middle of the step, so a turn bends the path
      const mid = (p.turn * ((s + prev) / 2) * Math.PI) / 180
      x += (s - prev) * p.distance * Math.sin(mid)
      z -= (s - prev) * p.distance * Math.cos(mid)
      prev = s
      const y = p.rise * s
      out.push({ position: [x, y, z], target: [x + Math.sin(heading) * Math.cos(down), y - Math.sin(down), z - Math.cos(heading) * Math.cos(down)] })
   }
   return out
}

/**
 * around a thing: fly from the picture's camera toward `center` (x, z on the floor of the render's
 * world), bend into a circle of `radius` metres around it and sweep `sweep` degrees (positive = the
 * camera goes round by the right), the eye at its height and the thing centred. One steady speed over the whole path, eased
 * only at its two ends, so clips cut from it (`frames` per clip, the last frame of one the first of
 * the next) join without a jump. `centerY` is the thing's height against the eye (below: negative),
 * `pitch` the degrees the first frame looks down, as the picture did
 */
export function orbitPath(p: { frames: number; center: [number, number]; radius: number; sweep: number; centerY?: number; pitch?: number }): PathCamera[] {
   const [cx, cz] = p.center
   const cy = p.centerY ?? 0
   const down = ((p.pitch ?? 0) * Math.PI) / 180
   const dist = Math.hypot(cx, cz)
   if (dist <= p.radius) throw new Error(`orbitPath: the camera starts inside the circle (${dist.toFixed(2)} m from its centre, radius ${p.radius} m)`)
   // the circle starts where the line from the centre to the camera meets it
   const phi0 = Math.atan2(-cx, -cz)
   const onCircle = (phi: number): [number, number] => [cx + p.radius * Math.sin(phi), cz + p.radius * Math.cos(phi)]
   const sweep = (p.sweep * Math.PI) / 180
   const dir = Math.sign(sweep) || 1
   // the approach: a cubic curve leaving straight ahead (-z) and landing on the circle along its tangent
   const [ex, ez] = onCircle(phi0)
   const approach = Math.hypot(ex, ez)
   const tangent: [number, number] = [dir * Math.cos(phi0), -dir * Math.sin(phi0)]
   const k = approach / 2.5
   const ctrl: [number, number][] = [[0, 0], [0, -k], [ex - tangent[0] * k, ez - tangent[1] * k], [ex, ez]]
   const bezier = (t: number): [number, number] => {
      const u = 1 - t
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const
      return [0, 1].map((a) => ctrl.reduce((acc, c, i) => acc + w[i]! * c[a]!, 0)) as [number, number]
   }
   // dense samples of the whole path: position, then where it looks
   const samples: { at: [number, number]; look: [number, number, number] }[] = []
   const N = 4000
   for (let i = 0; i <= N; i++) {
      const t = i / N
      const at = bezier(t)
      // the look turns from straight ahead to the centre over the approach
      const ease = t * t * (3 - 2 * t)
      const ahead: [number, number, number] = [at[0], -dist * Math.sin(down), at[1] - dist * Math.cos(down)]
      samples.push({ at, look: [ahead[0] + (cx - ahead[0]) * ease, ahead[1] + (cy - ahead[1]) * ease, ahead[2] + (cz - ahead[2]) * ease] })
   }
   for (let i = 1; i <= N; i++) samples.push({ at: onCircle(phi0 + (sweep * i) / N), look: [cx, cy, cz] })
   const cum = [0]
   for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!.at
      const b = samples[i]!.at
      cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
   }
   const total = cum.at(-1) ?? 0
   // steady speed, its ramp up and down over the first and last tenth of the path's time
   const ramp = 0.1
   const along = (t: number): number => {
      const v = 1 / (1 - ramp)
      if (t < ramp) return (v * t * t) / (2 * ramp)
      if (t > 1 - ramp) return 1 - (v * (1 - t) * (1 - t)) / (2 * ramp)
      return v * (t - ramp / 2)
   }
   const out: PathCamera[] = []
   let j = 0
   for (let f = 0; f < p.frames; f++) {
      const want = along(p.frames === 1 ? 0 : f / (p.frames - 1)) * total
      while (j < cum.length - 2 && cum[j + 1]! < want) j++
      const a = samples[j]!
      const b = samples[j + 1] ?? a
      const span = cum[j + 1]! - cum[j]!
      const r = span > 0 ? Math.min(1, Math.max(0, (want - cum[j]!) / span)) : 0
      const mix = (x: number, y: number) => x + (y - x) * r
      out.push({
         position: [mix(a.at[0], b.at[0]), 0, mix(a.at[1], b.at[1])],
         target: [mix(a.look[0], b.look[0]), mix(a.look[1], b.look[1]), mix(a.look[2], b.look[2])],
      })
   }
   return out
}

/** the settings that place every camera of a fly-through, all its clips together */
export type PathSettings = {
   path: 'walk' | 'orbit'
   /** frames of one clip; clips share their joining frame */
   length: number
   clips: number
   fovX: number
   distance: number
   turn: number
   rise: number
   aim: number
   /** the aimed thing's row in the picture, 0 = top edge, 1 = bottom edge */
   aimRow: number
   /** the picture's height over its width: the aimed row's angle */
   aspect: number
   aimDistance: number
   radius: number
   sweep: number
   /** degrees the picture's camera looks down at its floor. The path's world is levelled by it: y is
    * the floor's up, the orbit circles round that vertical, and frame 0 still looks down as the
    * picture did. A mesh in the picture's camera axes takes the same turn (levelPoint) */
   pitch: number
}

/** every camera of the whole path, `clips × (length - 1) + 1` of them; clip `k` is frames
 * `k × (length - 1)` to `(k + 1) × (length - 1)` */
export function pathCameras(p: PathSettings): PathCamera[] {
   const frames = p.clips * (p.length - 1) + 1
   if (p.path === 'walk') return walkPath({ frames, distance: p.distance, turn: p.turn, rise: p.rise, pitch: p.pitch })
   // the aimed thing: the picture's pixel (`aim`, `aimRow`), `aimDistance` along its ray, levelled
   const half = Math.tan((p.fovX * Math.PI) / 360)
   const ray: [number, number, number] = [(p.aim - 0.5) * 2 * half, (0.5 - p.aimRow) * 2 * half * p.aspect, -1]
   const length = Math.hypot(...ray)
   const [cx, cy, cz] = levelPoint(
      ray.map((x) => (x / length) * p.aimDistance) as [number, number, number],
      p.pitch,
   )
   return orbitPath({ frames, center: [cx, cz], centerY: cy, radius: p.radius, sweep: p.sweep, pitch: p.pitch })
}

/** a point of the picture's camera axes (y up, -z ahead) in the path's levelled world: turned
 * `pitch` degrees about x, so the picture's view axis points that much below the horizon */
export function levelPoint(q: [number, number, number], pitch: number): [number, number, number] {
   const a = (pitch * Math.PI) / 180
   return [q[0], q[1] * Math.cos(a) + q[2] * Math.sin(a), -q[1] * Math.sin(a) + q[2] * Math.cos(a)]
}

/** the vertical field of view of the frame Wan sees: the picture cover-cropped to `size`, its
 * focal length set by its horizontal field of view */
export function frameFovY(p: { picture: { width: number; height: number }; fovX: number; size: { width: number; height: number } }): number {
   const focal = p.picture.width / 2 / Math.tan((p.fovX * Math.PI) / 360)
   const aspect = p.size.width / p.size.height
   const croppedWidth = p.picture.width / p.picture.height > aspect
   const visibleHeight = croppedWidth ? p.picture.height : p.picture.width / aspect
   return (2 * Math.atan(visibleHeight / 2 / focal) * 180) / Math.PI
}

/** the video models a fly-through can use: their frame rate, and the frame counts they take */
export const ENGINES = {
   /** Wan 2.2 Fun Control 14B: 16 fps, 4n+1 frames */
   wan: { fps: 16, frames: (n: number) => Math.max(5, Math.round((n - 1) / 4) * 4 + 1) },
   /** MiniMax H3 with its Fun ControlNet: 24 fps, 17k+5 frames (snapped up, as its own template) */
   h3: { fps: 24, frames: (n: number) => Math.max(5, n) + ((5 - (Math.max(5, n) % 17) + 17) % 17) },
} as const
export type Engine = keyof typeof ENGINES

/** the frames of one clip of `seconds` for an engine */
export function clipFrames(engine: Engine, seconds: number): number {
   return ENGINES[engine].frames(Math.round(seconds * ENGINES[engine].fps))
}
