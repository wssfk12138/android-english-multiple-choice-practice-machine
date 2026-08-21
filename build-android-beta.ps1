param(
    [int]$VersionCode = 100,
    [string]$VersionName = '0.1.0-beta.1',
    [string]$DesktopDirectory = ''
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($DesktopDirectory)) {
    $DesktopDirectory = [Environment]::GetFolderPath('Desktop')
}
$DesktopDirectory = (Resolve-Path -LiteralPath $DesktopDirectory).Path
$frontendRoot = Join-Path $projectRoot 'frontend'
$androidRoot = Join-Path $frontendRoot 'android'
$signingProperties = Join-Path $androidRoot 'signing.properties'
$englishOneTarget = Join-Path $frontendRoot 'public\internal-question-bank.esq'
$englishTwoTarget = Join-Path $frontendRoot 'public\internal-question-bank-english-two.esq'
$apk = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'

if ($VersionCode -lt 1) { throw 'VersionCode must be a positive integer.' }
if ([string]::IsNullOrWhiteSpace($VersionName)) { throw 'VersionName cannot be empty.' }
if (-not (Test-Path -LiteralPath $signingProperties)) { throw "Fixed signing is not configured: $signingProperties" }
foreach ($bank in @($englishOneTarget, $englishTwoTarget)) {
    if (-not (Test-Path -LiteralPath $bank)) { throw "Bundled public ESQ is missing: $bank" }
}

$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'platform-tools'))) { throw "Android SDK is missing or incomplete: $sdkRoot" }
$jdkCandidates = @($env:JAVA_HOME)
foreach ($parent in @((Join-Path $env:ProgramFiles 'Microsoft'), (Join-Path $env:ProgramFiles 'Java'), (Join-Path $env:ProgramFiles 'Eclipse Adoptium'))) {
    if (Test-Path -LiteralPath $parent) {
        $jdkCandidates += Get-ChildItem -LiteralPath $parent -Directory -Filter '*21*' | Select-Object -ExpandProperty FullName
    }
}
$jdk = $jdkCandidates | Where-Object {
    $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe')) -and
        (Test-Path -LiteralPath (Join-Path $_ 'release')) -and
        ((Get-Content -LiteralPath (Join-Path $_ 'release') -Raw) -match 'JAVA_VERSION="21[.\-]')
} | Select-Object -First 1
if (-not $jdk) { throw 'JDK 21 was not found. Install it or set JAVA_HOME.' }

$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:JAVA_HOME = $jdk
$previousBank = $env:VITE_BUNDLED_QUESTION_BANK
$previousBanks = $env:VITE_BUNDLED_QUESTION_BANKS
$env:VITE_BUNDLED_QUESTION_BANK = '0'
$env:VITE_BUNDLED_QUESTION_BANKS = '1'

function Invoke-Checked([scriptblock]$Command, [string]$Description) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}

try {
    Push-Location $frontendRoot
    try {
        Invoke-Checked { corepack.cmd pnpm run build } 'Frontend build'
        Invoke-Checked { corepack.cmd pnpm exec cap sync android } 'Capacitor sync'
    } finally { Pop-Location }
    Push-Location $androidRoot
    try {
        Invoke-Checked { .\gradlew.bat assembleRelease "-PappVersionCode=$VersionCode" "-PappVersionName=$VersionName" } 'Gradle release build'
    } finally { Pop-Location }
} finally {
    $env:VITE_BUNDLED_QUESTION_BANK = $previousBank
    $env:VITE_BUNDLED_QUESTION_BANKS = $previousBanks
}

if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle finished without producing the release APK.' }
New-Item -ItemType Directory -Path $DesktopDirectory -Force | Out-Null
$target = Join-Path $DesktopDirectory "英语刷题机-Android-$VersionName-公测版.apk"
Copy-Item -LiteralPath $apk -Destination $target -Force
$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $target).Length
Write-Host "Android public beta APK: $target"
Write-Host "Version: $VersionName (versionCode $VersionCode)"
Write-Host "Size: $size bytes"
Write-Host "SHA-256: $hash"
