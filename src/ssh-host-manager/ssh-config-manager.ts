import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bang } from '../utils/bang'

export interface SSHHostConfig {
   host: string
   hostname: string
   user: string
   controlMaster?: string
   controlPath?: string
   controlPersist?: string
   identityFile?: string
   [key: string]: string | undefined
}

export class SSHConfigManager {
   private configPath: string

   constructor() {
      this.configPath = join(homedir(), '.ssh', 'config')
   }

   private parseConfig(): string {
      if (!existsSync(this.configPath)) return ''
      return readFileSync(this.configPath, 'utf8')
   }

   private formatHostConfig(config: SSHHostConfig): string {
      const lines = [`Host ${config.host}`]

      Object.entries(config).forEach(([key, value]) => {
         if (key !== 'host' && value) {
            const configKey = key
               .replace(/([A-Z])/g, (_match, letter) => (letter === key[0] ? letter : letter))
               .replace(/([a-z])([A-Z])/g, '$1$2')

            // Convert camelCase to SSH config format
            const sshKey =
               configKey.charAt(0).toUpperCase() +
               configKey.slice(1).replace(/([A-Z])/g, (_match, letter, index) => (index > 0 ? letter : letter))

            lines.push(`    ${sshKey} ${value}`)
         }
      })

      return lines.join('\n')
   }

   upsertSSHHostEntryInShhConfig(config: SSHHostConfig): void {
      const currentConfig = this.parseConfig()
      const hostPattern = new RegExp(`^Host\\s+${config.host}\\s*$`, 'm')

      // Find the host block
      const hostMatch = currentConfig.match(hostPattern)

      if (hostMatch) {
         // Update existing host
         const hostIndex = bang(hostMatch.index)
         const lines = currentConfig.split('\n')
         const hostLineIndex = currentConfig.substring(0, hostIndex).split('\n').length - 1

         // Find the end of this host block (next Host line or end of file)
         let endIndex = lines.length
         for (let i = hostLineIndex + 1; i < lines.length; i++) {
            if (lines[i]?.match(/^Host\s+/)) {
               endIndex = i
               break
            }
         }

         // Replace the host block
         const beforeHost = lines.slice(0, hostLineIndex)
         const afterHost = lines.slice(endIndex)
         const newConfig = [...beforeHost, this.formatHostConfig(config), ...afterHost].join('\n')

         writeFileSync(this.configPath, newConfig)
      } else {
         // Add new host
         const newHostConfig = this.formatHostConfig(config)
         const separator = currentConfig.trim() ? '\n\n' : ''
         const updatedConfig = currentConfig + separator + newHostConfig + '\n'

         writeFileSync(this.configPath, updatedConfig)
      }

      console.log(`✅ SSH config updated for host: ${config.host}`)
   }
}
