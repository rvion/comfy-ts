import { type ChildProcess, exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export class SSHHost {
   private host: string
   private activeProcesses: Set<ChildProcess>

   constructor(host: string) {
      this.host = host
      this.activeProcesses = new Set()
   }

   async ensurePortForward(port: number): Promise<void> {
      try {
         // Check if master connection exists
         await execAsync(`ssh -O check ${this.host} 2>/dev/null`)
         console.log('✅ SSH connection already active')
      } catch {
         // Establish master connection
         console.log('🔌 Establishing SSH connection...')
         // ssh -fN -R 8084:localhost:8084 wm
         // https://explainshell.com/explain?cmd=ssh+-fN+-L
         await execAsync(`ssh -fN -L ${port}:127.0.0.1:${port} ${this.host}`)
         console.log('✅ SSH connection established')
      }
   }

   async executeCommand(command: string): Promise<string> {
      await this.ensurePortForward()
      const { stdout, stderr } = await execAsync(`ssh ${this.host} "${command}"`)
      if (stderr) console.error('SSH Error:', stderr)
      return stdout.trim()
   }

   async executeCommandAndStream(
      command: string,
      onStdOut: (data: string) => void,
      onStdErr: (data: string) => void,
   ): Promise<number> {
      await this.ensurePortForward()

      return new Promise<number>((resolve, reject) => {
         const sshArgs = [this.host, command]
         const sshProcess: ChildProcess = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
         this.activeProcesses.add(sshProcess)

         sshProcess.stdout?.on('data', (dataBuffer) => {
            onStdOut(dataBuffer.toString())
         })

         sshProcess.stderr?.on('data', (dataBuffer) => {
            onStdErr(dataBuffer.toString())
         })

         sshProcess.on('close', (code: number | null) => {
            this.activeProcesses.delete(sshProcess)
            if (code === 0) {
               resolve(code)
            } else {
               // Non-zero exit code. Error messages should have been streamed via onStdErr.
               resolve(code ?? 1) // Resolve with the actual code, or 1 if null
            }
         })

         sshProcess.on('error', (err) => {
            this.activeProcesses.delete(sshProcess)
            // This event is emitted if the process could not be spawned, or could not be killed.
            onStdErr(`Failed to start or manage SSH process: ${err.message}\n`)
            reject(err) // Reject the promise on a spawn error
         })
      })
   }

   async executeCommandAndLog(command: string): Promise<number> {
      console.log(`[SSH ${this.host}] Executing: ${command}`)
      return this.executeCommandAndStream(
         command,
         (data) => console.log(`[SSH ${this.host} STDOUT] ${data.trimEnd()}`),
         (data) => console.error(`[SSH ${this.host} STDERR] ${data.trimEnd()}`),
      )
   }

   async closeConnection(): Promise<void> {
      // Terminate any active streamed commands
      if (this.activeProcesses.size > 0) {
         console.log(`🔌 Terminating ${this.activeProcesses.size} active SSH command(s)...`)
         this.activeProcesses.forEach((proc) => {
            if (!proc.killed) {
               proc.kill('SIGTERM') // Send SIGTERM to allow graceful shutdown
               // proc.kill('SIGKILL'); // Uncomment for forceful termination if SIGTERM is not effective
            }
         })
         this.activeProcesses.clear() // Clear the set
      }

      try {
         await execAsync(`ssh -O exit ${this.host}`)
         console.log('🔌 SSH master connection closed')
      } catch (_error) {
         // This error might mean the master connection was already down or never established.
         // If activeProcesses were found and killed, it's still useful information.
         const activeProcessesWereRunning = this.activeProcesses.size > 0 // Check before clearing, though it's cleared above
         if (!activeProcessesWereRunning) {
            // only log "no active connection" if there were no processes either
            console.log('No active SSH master connection to close, or it was already closed.')
         }
      }
   }
}

// Usage
// async function main() {
//    const ssh = new SSHManager('windows-machine')

//    try {
//       // Your commands here
//       const result = await ssh.executeCommand('dir C:\\')
//       console.log('Directory listing:', result)

//       const powershell = await ssh.executeCommand('powershell "Get-Date"')
//       console.log('Current time:', powershell)
//    } catch (error) {
//       console.error('Error:', error)
//    }

//    // Don't close connection - let it persist
//    // await ssh.closeConnection();
// }

// main()
