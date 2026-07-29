$ErrorActionPreference = "Stop"

$preferredToolRoot = "F:\GemeHuanJing\MCPMenderTools"
$legacyToolRoot = "F:\GemeHuanJing\MCPulseTools"
$toolRoot = if (Test-Path (Join-Path $preferredToolRoot "node\node.exe")) {
    $preferredToolRoot
} else {
    $legacyToolRoot
}
$nodeDir = Join-Path $toolRoot "node"
$pnpmScript = Join-Path $toolRoot "pnpm\bin\pnpm.mjs"

$env:PATH = "$nodeDir;$env:PATH"
$env:PNPM_HOME = Join-Path $toolRoot "pnpm-home"
$env:PNPM_STORE_DIR = Join-Path $toolRoot "pnpm-store"
$env:ELECTRON_CACHE = Join-Path $toolRoot "cache\electron"
$env:ELECTRON_BUILDER_CACHE = Join-Path $toolRoot "cache\electron-builder"
$env:NPM_CONFIG_CACHE = Join-Path $toolRoot "cache\npm"
$env:TEMP = Join-Path $toolRoot "temp"
$env:TMP = $env:TEMP

New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

& (Join-Path $nodeDir "node.exe") $pnpmScript @args
exit $LASTEXITCODE
