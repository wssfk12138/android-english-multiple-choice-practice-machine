param(
    [int]$Port = 8877
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $projectRoot 'work\internal-channel\server.pid'
$targetPids = @()

if (Test-Path -LiteralPath $pidFile) {
    $savedPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($savedPid -match '^\d+$') {
        $targetPids += [int]$savedPid
    }
}
$targetPids += Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess
$targetPids = $targetPids | Where-Object { $_ -gt 0 } | Select-Object -Unique

foreach ($processId in $targetPids) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -like 'python*') {
        Stop-Process -Id $processId
    }
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host 'Internal update server stopped.'
