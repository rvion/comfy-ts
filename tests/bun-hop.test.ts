import { describe, expect, it } from 'bun:test'

// the bin runs under node and re-execs the command through bun (src/cli/bunHop.ts).
// One subprocess pair per case: the property under test IS the process tree.

type Started = { wrapper: Bun.Subprocess<'ignore', 'pipe', 'inherit'>; childPid: number }

async function startWrapper(): Promise<Started> {
   const wrapper = Bun.spawn(['bun', 'tests/fixtures/bun-hop/wrapper.ts'], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'inherit',
   })
   const reader = wrapper.stdout.getReader()
   let text = ''
   for (;;) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error(`wrapper ended before the child started: ${text}`)
      text += new TextDecoder().decode(chunk.value)
      const m = /child (\d+)/.exec(text)
      if (m != null) {
         reader.releaseLock()
         return { wrapper, childPid: Number(m[1]) }
      }
   }
}

const alive = (pid: number): boolean => {
   try {
      process.kill(pid, 0)
      return true
   } catch {
      return false
   }
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
   const end = Date.now() + ms
   while (Date.now() < end) {
      if (!alive(pid)) return true
      await Bun.sleep(20)
   }
   return !alive(pid)
}

async function expectChildGone(p: Started, ms: number): Promise<void> {
   const gone = await goneWithin(p.childPid, ms)
   if (!gone) process.kill(p.childPid, 'SIGKILL')
   expect(gone).toBe(true)
}

describe('the bun hop never leaves an orphan', () => {
   it('control: a child that dies ends the wrapper with a failing code', async () => {
      const p = await startWrapper()
      process.kill(p.childPid, 'SIGTERM')
      expect(await p.wrapper.exited).not.toBe(0)
   })

   it('a SIGTERM to the wrapper stops the bun child too', async () => {
      // why we think it is actually a bug, and not just meaning spec should change: the wrapper is the process a supervisor, a terminal or an agent holds and stops. Stopping it left the bun child running under pid 1, serving or spinning with no owner, which is how stray panels piled up on a machine
      const p = await startWrapper()
      p.wrapper.kill('SIGTERM')
      await expectChildGone(p, 1500)
   })

   it('a SIGKILL to the wrapper, which no handler sees, still ends the child', async () => {
      // why we think it is actually a bug, and not just meaning spec should change: same orphan as SIGTERM, reached by a hard kill that the wrapper cannot forward, so only the child can notice that its parent is gone
      const p = await startWrapper()
      p.wrapper.kill('SIGKILL')
      await expectChildGone(p, 1500)
   })
})
