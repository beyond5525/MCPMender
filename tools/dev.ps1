$ErrorActionPreference = "Stop"

$preferredToolRoot = "F:\GemeHuanJing\MCPMenderTools"
$legacyToolRoot = "F:\GemeHuanJing\MCPulseTools"
$candidateToolRoots = @($env:MCPMENDER_TOOL_ROOT)
if ($env:OS -eq "Windows_NT") {
    $candidateToolRoots += @($preferredToolRoot, $legacyToolRoot)
}
$candidateToolRoots = $candidateToolRoots |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$toolRoot = $candidateToolRoots |
    Where-Object {
        (Test-Path -LiteralPath (Join-Path $_ "node\node.exe") -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $_ "pnpm\bin\pnpm.mjs") -PathType Leaf)
    } |
    Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($toolRoot)) {
    $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($null -eq $pnpmCommand) {
        throw "pnpm was not found. Install Node.js and pnpm, or set MCPMENDER_TOOL_ROOT to a portable tool directory."
    }
    & $pnpmCommand.Source @args
    exit $LASTEXITCODE
}

$nodeDir = Join-Path $toolRoot "node"
$pnpmScript = Join-Path $toolRoot "pnpm\bin\pnpm.mjs"

$env:PATH = "$nodeDir;$env:PATH"
$env:PNPM_HOME = Join-Path $toolRoot "pnpm-home"
$env:PNPM_STORE_DIR = Join-Path $toolRoot "pnpm-store"
$env:npm_config_store_dir = $env:PNPM_STORE_DIR
$env:npm_config_virtual_store_dir = Join-Path $toolRoot "virtual-store\MCPMender"
$env:ELECTRON_CACHE = Join-Path $toolRoot "cache\electron"
$env:ELECTRON_BUILDER_CACHE = Join-Path $toolRoot "cache\electron-builder"
$env:NPM_CONFIG_CACHE = Join-Path $toolRoot "cache\npm"
$env:TEMP = Join-Path $toolRoot "temp"
$env:TMP = $env:TEMP

New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

& (Join-Path $nodeDir "node.exe") $pnpmScript @args
exit $LASTEXITCODE
