param(
    [int]$VersionCode = 5,
    [string]$VersionName = '0.1.0-alpha.5',
    [string]$AppUpdateManifestUrl = '',
    [string]$QuestionBankCatalogUrl = '',
    [string]$BundledQuestionBank = '',
    [string]$BundledQuestionBankSha256 = ''
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Join-Path $projectRoot 'frontend'
$androidRoot = Join-Path $frontendRoot 'android'
$signingProperties = Join-Path $androidRoot 'signing.properties'
$outputRoot = Join-Path $projectRoot 'outputs\internal-channel'
$bundledBankSource = if ([string]::IsNullOrWhiteSpace($BundledQuestionBank)) {
    Join-Path $frontendRoot 'public\internal-question-bank.esq'
} elseif ([System.IO.Path]::IsPathRooted($BundledQuestionBank)) {
    [System.IO.Path]::GetFullPath($BundledQuestionBank)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectRoot $BundledQuestionBank))
}
$bundledBankTarget = Join-Path $frontendRoot 'public\internal-question-bank.esq'
$bundledBankBackup = $null
$bundledBankOverride = -not [string]::Equals([System.IO.Path]::GetFullPath($bundledBankSource), [System.IO.Path]::GetFullPath($bundledBankTarget), [System.StringComparison]::OrdinalIgnoreCase)
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
$workspaceSdkRoot = [System.IO.Path]::Combine($workspaceRoot, '.toolchains', 'android-sdk')
$defaultSdkRoot = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $null
} else {
    [System.IO.Path]::Combine($env:LOCALAPPDATA, 'Android', 'Sdk')
}
$sdkCandidates = @(
    $env:ANDROID_PLUGIN_SDK_PATH,
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    $workspaceSdkRoot,
    $defaultSdkRoot
) | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_)
} | Select-Object -Unique
$sdkRoot = $sdkCandidates | Where-Object {
    try {
        (Test-Path -LiteralPath ([System.IO.Path]::Combine([string]$_, 'platform-tools', 'adb.exe'))) -and
            (Test-Path -LiteralPath ([System.IO.Path]::Combine([string]$_, 'platforms', 'android-36', 'android.jar')))
    } catch {
        $false
    }
} | Select-Object -First 1
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

if ($VersionCode -lt 1) {
    throw 'VersionCode must be a positive integer.'
}
if ([string]::IsNullOrWhiteSpace($VersionName)) {
    throw 'VersionName cannot be empty.'
}
if (-not (Test-Path -LiteralPath $signingProperties)) {
    throw "Fixed signing is not configured: $signingProperties"
}
if (-not (Test-Path -LiteralPath $bundledBankSource)) {
    throw "The internal ESQ seed is missing: $bundledBankSource"
}
if (-not [string]::IsNullOrWhiteSpace($BundledQuestionBankSha256)) {
    $expectedBundledBankHash = $BundledQuestionBankSha256.Trim().ToLowerInvariant()
    if ($expectedBundledBankHash -notmatch '^[0-9a-f]{64}$') {
        throw 'BundledQuestionBankSha256 must contain exactly 64 hexadecimal characters.'
    }
    $actualBundledBankHash = (Get-FileHash -LiteralPath $bundledBankSource -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualBundledBankHash -ne $expectedBundledBankHash) {
        throw "The internal ESQ seed SHA-256 does not match. Expected $expectedBundledBankHash, got $actualBundledBankHash."
    }
}
if (-not $sdkRoot) {
    throw "Android SDK is missing or incomplete. Checked: $($sdkCandidates -join ', ')"
}
if (-not $jdkCandidates) {
    throw 'JDK 21 was not found. Install it or set JAVA_HOME.'
}

$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:JAVA_HOME = @($jdkCandidates)[0]
$previousAppManifest = $env:VITE_APP_UPDATE_MANIFEST_URL
$previousBankCatalog = $env:VITE_QUESTION_BANK_CATALOG_URL
$previousBundledBank = $env:VITE_BUNDLED_QUESTION_BANK
$previousBundledBanks = $env:VITE_BUNDLED_QUESTION_BANKS
$env:VITE_APP_UPDATE_MANIFEST_URL = $AppUpdateManifestUrl.Trim()
$env:VITE_QUESTION_BANK_CATALOG_URL = $QuestionBankCatalogUrl.Trim()
$env:VITE_BUNDLED_QUESTION_BANKS = '1'

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

try {
    if ($bundledBankOverride) {
        if (Test-Path -LiteralPath $bundledBankTarget) {
            $bundledBankBackup = [System.IO.File]::ReadAllBytes($bundledBankTarget)
        }
        Copy-Item -LiteralPath $bundledBankSource -Destination $bundledBankTarget -Force
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
        Invoke-Checked {
            .\gradlew.bat assembleInternal `
                "-PappVersionCode=$VersionCode" `
                "-PappVersionName=$VersionName"
        } 'Gradle internal build'
    } finally {
        Pop-Location
    }
} finally {
    if ($bundledBankOverride) {
        if ($null -ne $bundledBankBackup) {
            [System.IO.File]::WriteAllBytes($bundledBankTarget, $bundledBankBackup)
        } else {
            Remove-Item -LiteralPath $bundledBankTarget -Force -ErrorAction SilentlyContinue
        }
    }
    $env:VITE_APP_UPDATE_MANIFEST_URL = $previousAppManifest
    $env:VITE_QUESTION_BANK_CATALOG_URL = $previousBankCatalog
    $env:VITE_BUNDLED_QUESTION_BANK = $previousBundledBank
    $env:VITE_BUNDLED_QUESTION_BANKS = $previousBundledBanks
}

$apk = Join-Path $androidRoot 'app\build\outputs\apk\internal\app-internal.apk'
if (-not (Test-Path -LiteralPath $apk)) {
    throw 'Gradle finished without producing the internal APK.'
}
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$target = Join-Path $outputRoot "english-practice-machine-android-$VersionName-internal.apk"
Copy-Item -LiteralPath $apk -Destination $target -Force
Write-Host "Android internal APK: $target"
