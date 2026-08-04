param(
    [int]$Port = 8877
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw '请右键使用管理员身份运行 PowerShell，再执行此脚本。'
}

$ruleName = '英语刷题机 Android 内测更新'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Remove-NetFirewallRule -DisplayName $ruleName
}
New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -RemoteAddress LocalSubnet `
    -Profile Any `
    -Description '仅允许本地子网访问英语刷题机 Android 内测更新文件' | Out-Null

Write-Host "已允许本地子网访问 TCP $Port。"
