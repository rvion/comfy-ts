# SSH configuration for Windows

## install OpenSSH Server on Windows using PowerShell

```powershell
# Install OpenSSH Server
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Start the service
Start-Service sshd

# Set it to start automatically (optional)
Set-Service -Name sshd -StartupType 'Automatic'

# Configure firewall
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```



## Generate


```shell
ssh-keygen -t rsa -P ""
ssh-copy-id windows-machine
```


## update your config.



## test it wokrs.

```
ssh windows-machine
```