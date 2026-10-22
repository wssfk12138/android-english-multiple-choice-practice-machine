$ErrorActionPreference = 'Stop'

# Bundle the verified Sherpa-ONNX engine and the two Piper INT8 voices into the
# Android app. Runtime downloads are intentionally not used.
$frontend = Split-Path -Parent $PSScriptRoot
$android = Join-Path $frontend 'android'
$libs = Join-Path $android 'app\libs'
$assets = Join-Path $android 'app\src\main\assets\tts'
$cache = Join-Path $frontend '.tts-cache'

$aarName = 'sherpa-onnx-1.13.8.aar'
$aarUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-1.13.8.aar'
$aarHash = '633C24321E06B1FE79FEAFA03EA16CBC0F8A286641E2DA3559BAC91BDB13BD96'
$models = @(
    @{ Name = 'vits-piper-en_US-ljspeech-medium-int8'; Target = 'en_US'; Model = 'en_US-ljspeech-medium.onnx'; Url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-ljspeech-medium-int8.tar.bz2'; Hash = '24DC3BD77DD48C291E52C297878D3437C9492F245D823D7F6A06C4BBB67F4B6B' },
    # Cori prolongs final /d/; Alan medium passed listening acceptance and keeps 22.05 kHz audio.
    @{ Name = 'vits-piper-en_GB-alan-medium-int8'; Target = 'en_GB'; Model = 'en_GB-alan-medium.onnx'; Url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_GB-alan-medium-int8.tar.bz2'; Hash = 'F0B2526C9600657141CCBBE412F6159DCEEDAB5BAB4BA4E8857D9443ACB50DE4' }
)

New-Item -ItemType Directory -Force -Path $libs, $assets, $cache | Out-Null

function Get-VerifiedFile([string]$url, [string]$path, [string]$hash) {
    if (Test-Path -LiteralPath $path) {
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        if ($actual -eq $hash) { return }
        Remove-Item -LiteralPath $path -Force
    }
    & curl.exe -L --fail --retry 3 --output $path $url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -ne $hash) {
        throw ("SHA-256 mismatch: " + $path + [Environment]::NewLine + "Expected: " + $hash + [Environment]::NewLine + "Actual: " + $actual)
    }
}

$aarPath = Join-Path $libs $aarName
Get-VerifiedFile $aarUrl $aarPath $aarHash

foreach ($item in $models) {
    $archive = Join-Path $cache ($item.Name + '.tar.bz2')
    Get-VerifiedFile $item.Url $archive $item.Hash
    $extract = Join-Path $cache $item.Name
    if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    & tar.exe -xjf $archive -C $extract
    if ($LASTEXITCODE -ne 0) { throw "Unable to extract $archive" }
    $source = Join-Path $extract $item.Name
    $target = Join-Path $assets $item.Target
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -LiteralPath (Join-Path $source $item.Model) -Destination (Join-Path $target 'model.onnx')
    Copy-Item -LiteralPath (Join-Path $source 'tokens.txt') -Destination (Join-Path $target 'tokens.txt')
    Copy-Item -LiteralPath (Join-Path $source 'MODEL_CARD') -Destination (Join-Path $target 'MODEL_CARD')
    if ($item.Target -eq 'en_GB') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'tts-licenses\en_GB-alan-LICENSE.txt') -Destination (Join-Path $target 'LICENSE')
    }
    $json = Get-ChildItem -LiteralPath $source -Filter '*.onnx.json' | Select-Object -First 1
    if ($json) { Copy-Item -LiteralPath $json.FullName -Destination (Join-Path $target 'model.onnx.json') }
    Copy-Item -LiteralPath (Join-Path $source 'espeak-ng-data') -Destination (Join-Path $target 'espeak-ng-data') -Recurse
}

$bytes = (Get-ChildItem -LiteralPath $assets -Recurse -File | Measure-Object -Property Length -Sum).Sum
"TTS assets ready: {0:N1} MiB at {1}" -f ($bytes / 1MB), $assets
