param(
    [int]$Port = 8877,
    [string]$BindAddress = '0.0.0.0'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$channelRoot = Join-Path $projectRoot 'work\internal-channel'
$pythonCandidates = @(
    (Join-Path $projectRoot '.venv\Scripts\python.exe'),
    (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not (Test-Path -LiteralPath (Join-Path $channelRoot 'question-bank-catalog.json'))) {
    throw "The internal update channel has not been prepared: $channelRoot"
}
if (-not $pythonCandidates) {
    throw 'Python was not found.'
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "The internal update server is already listening on port $Port."
    return
}

$python = @($pythonCandidates)[0]
$env:INTERNAL_CHANNEL_PORT = [string]$Port
$process = Start-Process -FilePath $python `
    -ArgumentList @((Join-Path $projectRoot 'diagnostic_receiver.py')) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru
[System.IO.File]::WriteAllText(
    (Join-Path $channelRoot 'server.pid'),
    [string]$process.Id,
    (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "Internal update and diagnostic server started. PID: $($process.Id), port: $Port"
