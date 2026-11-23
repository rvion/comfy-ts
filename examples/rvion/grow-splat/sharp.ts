// lift one picture to 3D gaussians with Apple's SHARP (github.com/apple/ml-sharp), which runs outside ComfyUI:
// locally when its `sharp` cli is on the PATH, or on a box over ssh. The box is named by the environment only:
//    SHARP_SSH=<ssh destination>   SHARP_ROOT=<SHARP's folder on it, holding .venv>   SHARP_WORK=<a folder for files>
// on a Windows box each step runs in its own ssh call: a chained cmd.exe line can fail without a word
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'pathe'

function run(cmd: string, args: string[]): string {
   const r = spawnSync(cmd, args, { encoding: 'utf8' })
   if (r.error != null) throw new Error(`${cmd} failed to start: ${r.error.message}`)
   if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}:\n${r.stderr}${r.stdout}`.trim())
   return `${r.stdout}${r.stderr}`
}

/** SHARP on `png` writes `outPly`; SHARP reads no focal from a png, so it assumes 30 mm (f = width × 30 / 36) */
export function sharpPredict(png: string, outPly: string): void {
   mkdirSync(dirname(outPly), { recursive: true })
   const stem = basename(png).replace(/\.[^.]+$/, '')
   const ssh = process.env.SHARP_SSH
   if (ssh == null || ssh === '') {
      const outDir = join(dirname(outPly), `.sharp-${stem}`)
      run('sharp', ['predict', '-i', png, '-o', outDir])
      run('mv', [join(outDir, `${stem}.ply`), outPly])
      return
   }
   const root = process.env.SHARP_ROOT
   const work = process.env.SHARP_WORK
   if (root == null || root === '' || work == null || work === '')
      throw new Error('SHARP_SSH is set: SHARP_ROOT (the SHARP folder on the box) and SHARP_WORK (a folder for files) must be too')
   const win = /^[A-Za-z]:\\/.test(work)
   const sep = win ? '\\' : '/'
   const remoteIn = `${work}${sep}in${sep}${stem}.png`
   const remoteOut = `${work}${sep}out`
   const fwd = (p: string) => p.replaceAll('\\', '/')
   for (const dir of [work, `${work}${sep}in`, remoteOut]) {
      // mkdir fails when the folder exists, on both shells: the scp below is what proves the folder is there
      spawnSync('ssh', [ssh, win ? `if not exist "${dir}" mkdir "${dir}"` : `mkdir -p '${dir}'`], { encoding: 'utf8' })
   }
   run('scp', ['-q', png, `${ssh}:${fwd(remoteIn)}`])
   const exe = win ? `${root}\\.venv\\Scripts\\sharp.exe` : `${root}/.venv/bin/sharp`
   run('ssh', [ssh, `"${exe}" predict -i "${remoteIn}" -o "${remoteOut}"`])
   run('scp', ['-q', `${ssh}:${fwd(`${remoteOut}${sep}${stem}.ply`)}`, outPly])
   if (!existsSync(outPly)) throw new Error(`SHARP gave no ${outPly}`)
}
