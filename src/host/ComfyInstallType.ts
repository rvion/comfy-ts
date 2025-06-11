import type { SSHHostConfig } from '../ssh-host-manager/ssh-config-manager'

// biome-ignore format: misc
export type ComfyInstallType =
   | ComfyInstallTypeLocal
   | ComfyInstallTypeRemote

export type ComfyInstallTypeLocal = {
   type: 'local'
   absolutePathToComfyRoot?: string
}

export type ComfyInstallTypeRemote = {
   type: 'remote'
   absolutePathToComfyRoot?: string
   sshHostConfigd: SSHHostConfig
}
