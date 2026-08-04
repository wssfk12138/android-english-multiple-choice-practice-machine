$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Join-Path $projectRoot 'frontend'
$androidRoot = Join-Path $frontendRoot 'android'
$sdkRoot = if ($env:ANDROID_SDK_ROOT) {
    $env:ANDROID_SDK_ROOT
} else {
    Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
$jdkCandidates = @($env:JAVA_HOME)
foreach ($parent in @(
    (Join-Path $env:ProgramFiles 'Microsoft'),
    (Join-Path $env:ProgramFiles 'Java'),
    (Join-Path $env:ProgramFiles 'Eclipse Adoptium')
)) {
    if (Test-Path -LiteralPath $parent) {
        $jdkCandidates += Get-ChildItem -LiteralPath $parent -Directory -Filter '*21*' |
            Select-Object -ExpandProperty FullName
    }
}
$jdkCandidates = $jdkCandidates |
    Where-Object {
        if (-not $_ -or -not (Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe'))) {
            return $false
        }
        $releaseFile = Join-Path $_ 'release'
        return (Test-Path -LiteralPath $releaseFile) -and
            ((Get-Content -LiteralPath $releaseFile -Raw) -match 'JAVA_VERSION="21[.\-]')
    } |
    Select-Object -Unique

if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'platform-tools'))) {
    throw "Android SDK is missing or incomplete: $sdkRoot"
}
if (-not $jdkCandidates) {
    throw 'JDK 21 was not found. Install it or set JAVA_HOME.'
}

$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:JAVA_HOME = @($jdkCandidates)[0]

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [scriptblock]$Command,
        [Parameter(Mandatory)]
        [string]$Description
    )
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

Push-Location $frontendRoot
try {
    Invoke-Checked { corepack.cmd pnpm run build } 'Frontend build'
    Invoke-Checked { corepack.cmd pnpm exec cap sync android } 'Capacitor sync'
} finally {
    Pop-Location
}

Push-Location $androidRoot
try {
    Invoke-Checked { .\gradlew.bat assembleDebug } 'Gradle build'
} finally {
    Pop-Location
}

$apk = Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) {
    throw 'Gradle finished without producing the debug APK.'
}

Write-Host "Android debug APK: $apk"
