[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$PackagePath,

    [string]$Node20Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspaceManifest = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$expectedVersion = [string]$workspaceManifest.version
$workRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "work\verify-cli-artifact"))
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath -ErrorAction Stop).Path
$preferredToolRoot = [System.IO.Path]::GetFullPath("F:\GemeHuanJing\MCPMenderTools")
$legacyToolRoot = [System.IO.Path]::GetFullPath("F:\GemeHuanJing\MCPulseTools")

function Invoke-CapturedNative {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = (& $Executable @Arguments 2>&1) -join "`n"
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    return [pscustomobject]@{
        Output = $output
        ExitCode = $exitCode
    }
}

function Resolve-Node20 {
    $candidates = [System.Collections.Generic.List[string]]::new()
    if (-not [string]::IsNullOrWhiteSpace($Node20Path)) {
        $candidates.Add([System.IO.Path]::GetFullPath($Node20Path))
    }
    foreach ($toolRoot in @($preferredToolRoot, $legacyToolRoot)) {
        $candidates.Add((Join-Path $toolRoot "node20\node.exe"))
        $candidates.Add((Join-Path $toolRoot "node-v20\node.exe"))

        foreach ($searchBase in @($toolRoot, (Join-Path $toolRoot "temp"))) {
            if (-not (Test-Path -LiteralPath $searchBase -PathType Container)) {
                continue
            }
            $matchingDirectories = @(
                Get-ChildItem -LiteralPath $searchBase -Directory -Filter "node-v20*-win-x64" -ErrorAction SilentlyContinue
            )
            if ($searchBase.EndsWith("\temp", [System.StringComparison]::OrdinalIgnoreCase)) {
                $auditDirectories = @(
                    Get-ChildItem -LiteralPath $searchBase -Directory -Filter "release-audit-*" -ErrorAction SilentlyContinue
                )
                foreach ($auditDirectory in $auditDirectories) {
                    $matchingDirectories += @(
                        Get-ChildItem -LiteralPath $auditDirectory.FullName -Directory -Filter "node-v20*-win-x64" -ErrorAction SilentlyContinue
                    )
                }
            }
            foreach ($matchingDirectory in $matchingDirectories) {
                $candidates.Add((Join-Path $matchingDirectory.FullName "node.exe"))
            }
        }
    }

    $visited = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($candidate in $candidates) {
        if (-not $visited.Add($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            continue
        }
        $versionResult = Invoke-CapturedNative -Executable $candidate -Arguments @("--version")
        if ($versionResult.ExitCode -eq 0 -and $versionResult.Output.Trim() -match "^v20\.\d+\.\d+$") {
            return [pscustomobject]@{
                Path = (Resolve-Path -LiteralPath $candidate).Path
                Version = $versionResult.Output.Trim()
            }
        }
    }

    throw "CLI release verification requires an official Node.js 20 x64 runtime under '$preferredToolRoot' (or pass -Node20Path)."
}

function Assert-SafeTarPath {
    param([Parameter(Mandatory = $true)][string]$EntryName)

    if ([string]::IsNullOrWhiteSpace($EntryName) -or $EntryName.IndexOf([char]0) -ge 0 -or $EntryName.Contains("\")) {
        throw "CLI archive contains an empty, NUL, or backslash path: '$EntryName'."
    }
    $trimmed = $EntryName.TrimEnd("/")
    if ([string]::IsNullOrWhiteSpace($trimmed) -or
        $trimmed.StartsWith("/", [System.StringComparison]::Ordinal) -or
        $trimmed.Contains(":")) {
        throw "CLI archive contains a rooted or drive-like path: '$EntryName'."
    }
    $segments = @($trimmed.Split("/"))
    if (@($segments | Where-Object { $_ -eq "" -or $_ -eq "." -or $_ -eq ".." }).Count -gt 0) {
        throw "CLI archive contains an unsafe path segment: '$EntryName'."
    }
    if ($segments[0] -cne "package") {
        throw "CLI archive entry is outside the npm package root: '$EntryName'."
    }
}

if (-not $workRoot.StartsWith([System.IO.Path]::GetFullPath((Join-Path $projectRoot "work")).TrimEnd("\") + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use unexpected CLI verification directory '$workRoot'."
}
if ((Get-Item -LiteralPath $resolvedPackage).Name -cne "mcpmender-$expectedVersion.tgz") {
    throw "CLI archive name must be exactly 'mcpmender-$expectedVersion.tgz'."
}

$node20 = Resolve-Node20
$nodePath = $node20.Path
$nodeDirectory = Split-Path -Parent $nodePath
$npmPath = Join-Path $nodeDirectory "npm.cmd"
if (-not (Test-Path -LiteralPath $npmPath -PathType Leaf)) {
    throw "The selected Node.js 20 runtime has no adjacent npm.cmd: '$nodePath'."
}

if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
}
$extractRoot = Join-Path $workRoot "extract"
$installRoot = Join-Path $workRoot "install"
$homeRoot = Join-Path $workRoot "home"
$appData = Join-Path $homeRoot "AppData\Roaming"
$claudeDirectory = Join-Path $appData "Claude"
$runtimeTemp = Join-Path $preferredToolRoot "temp\verify-cli-artifact"
$npmCache = Join-Path $preferredToolRoot "cache\npm"
New-Item -ItemType Directory -Force -Path $extractRoot, $installRoot, $claudeDirectory, $runtimeTemp, $npmCache | Out-Null

$tarListResult = Invoke-CapturedNative -Executable "tar.exe" -Arguments @("-tzf", $resolvedPackage)
if ($tarListResult.ExitCode -ne 0) {
    throw "Unable to list CLI package '$resolvedPackage': $($tarListResult.Output)"
}
$tarEntries = @($tarListResult.Output -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$seenTarEntries = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($tarEntry in $tarEntries) {
    Assert-SafeTarPath -EntryName $tarEntry
    if (-not $seenTarEntries.Add($tarEntry)) {
        throw "CLI archive contains a duplicate or case-conflicting entry: '$tarEntry'."
    }
}
$requiredArchiveFiles = @(
    "package/package.json",
    "package/README.md",
    "package/dist/mcpmender.cjs",
    "package/dist/LICENSE",
    "package/dist/THIRD_PARTY_NOTICES.md"
)
foreach ($requiredArchiveFile in $requiredArchiveFiles) {
    if (-not $seenTarEntries.Contains($requiredArchiveFile)) {
        throw "CLI archive is missing required file '$requiredArchiveFile'."
    }
}

$extractResult = Invoke-CapturedNative -Executable "tar.exe" -Arguments @("-xzf", $resolvedPackage, "-C", $extractRoot)
if ($extractResult.ExitCode -ne 0) {
    throw "Unable to extract CLI package '$resolvedPackage': $($extractResult.Output)"
}
$packageManifestPath = Join-Path $extractRoot "package\package.json"
$packageManifest = Get-Content -LiteralPath $packageManifestPath -Raw | ConvertFrom-Json
if ($packageManifest.name -ne "mcpmender" -or $packageManifest.version -ne $expectedVersion) {
    throw "Packed CLI metadata does not identify mcpmender $expectedVersion."
}
if ([string]$packageManifest.bin.mcpmender -cne "dist/mcpmender.cjs") {
    throw "Packed CLI bin.mcpmender must point to dist/mcpmender.cjs."
}
if ([string]$packageManifest.engines.node -notmatch "(^|[^\d])20([^\d]|$)|>=\s*20") {
    throw "Packed CLI engines.node does not require Node.js 20 or newer."
}

$secret = "AUDIT_SECRET_VALUE_42_DO_NOT_RELEASE"
$config = @{
    mcpServers = @{
        "artifact-redaction" = @{
            command = $nodePath
            args = @("--api-key", $secret, "--version")
        }
    }
} | ConvertTo-Json -Depth 8
Set-Content -LiteralPath (Join-Path $claudeDirectory "claude_desktop_config.json") -Value $config -Encoding utf8

$previousEnvironment = @{
    USERPROFILE = $env:USERPROFILE
    APPDATA = $env:APPDATA
    XDG_CONFIG_HOME = $env:XDG_CONFIG_HOME
    TEMP = $env:TEMP
    TMP = $env:TMP
    PATH = $env:PATH
    NPM_CONFIG_CACHE = $env:NPM_CONFIG_CACHE
}
try {
    $env:USERPROFILE = $homeRoot
    $env:APPDATA = $appData
    $env:XDG_CONFIG_HOME = Join-Path $homeRoot ".config"
    $env:TEMP = $runtimeTemp
    $env:TMP = $runtimeTemp
    $env:NPM_CONFIG_CACHE = $npmCache
    $env:PATH = "$nodeDirectory;$($previousEnvironment.PATH)"

    $installResult = Invoke-CapturedNative -Executable $npmPath -Arguments @(
        "install",
        "--prefix", $installRoot,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        $resolvedPackage
    )
    if ($installResult.ExitCode -ne 0) {
        throw "npm installation of the CLI archive failed under Node $($node20.Version): $($installResult.Output)"
    }

    $installedPackageRoot = Join-Path $installRoot "node_modules\mcpmender"
    foreach ($requiredRelativeFile in @("package.json", "README.md", "dist\mcpmender.cjs", "dist\LICENSE", "dist\THIRD_PARTY_NOTICES.md")) {
        if (-not (Test-Path -LiteralPath (Join-Path $installedPackageRoot $requiredRelativeFile) -PathType Leaf)) {
            throw "npm installation is missing required file '$requiredRelativeFile'."
        }
    }
    $cliCommand = Join-Path $installRoot "node_modules\.bin\mcpmender.cmd"
    if (-not (Test-Path -LiteralPath $cliCommand -PathType Leaf)) {
        throw "npm did not create the mcpmender command shim."
    }

    $versionResult = Invoke-CapturedNative -Executable $cliCommand -Arguments @("--version")
    if ($versionResult.ExitCode -ne 0 -or $versionResult.Output.Trim() -cne $expectedVersion) {
        throw "Installed mcpmender --version did not return exactly '$expectedVersion': $($versionResult.Output)"
    }
    $helpResult = Invoke-CapturedNative -Executable $cliCommand -Arguments @("--help")
    if ($helpResult.ExitCode -ne 0 -or $helpResult.Output -notmatch "MCPMender|mcpmender") {
        throw "Installed mcpmender --help failed or did not identify MCPMender."
    }

    $scanResult = Invoke-CapturedNative -Executable $cliCommand -Arguments @("scan", "--json", "--lang", "en")
    if ($scanResult.ExitCode -ne 0) {
        throw "Installed CLI scan failed with exit code $($scanResult.ExitCode): $($scanResult.Output)"
    }
    if ($scanResult.Output.IndexOf($secret, [System.StringComparison]::Ordinal) -ge 0) {
        throw "Installed CLI leaked a paired command-line secret in redacted JSON."
    }

    $unknownResult = Invoke-CapturedNative -Executable $cliCommand -Arguments @("scan", "--definitely-unknown")
    if ($unknownResult.ExitCode -ne 1 -or $unknownResult.Output -notmatch "Unknown option") {
        throw "Installed CLI did not reject an unknown option with exit code 1."
    }

    $missingServerResult = Invoke-CapturedNative -Executable $cliCommand -Arguments @(
        "probe", "--run", "--server", "definitely-missing", "--json"
    )
    if ($missingServerResult.ExitCode -ne 1 -or $missingServerResult.Output -notmatch "No configured server matched") {
        throw "Installed CLI did not reject an unmatched server filter with exit code 1."
    }
}
finally {
    $env:USERPROFILE = $previousEnvironment.USERPROFILE
    $env:APPDATA = $previousEnvironment.APPDATA
    $env:XDG_CONFIG_HOME = $previousEnvironment.XDG_CONFIG_HOME
    $env:TEMP = $previousEnvironment.TEMP
    $env:TMP = $previousEnvironment.TMP
    $env:PATH = $previousEnvironment.PATH
    $env:NPM_CONFIG_CACHE = $previousEnvironment.NPM_CONFIG_CACHE
}

Write-Host "Packed CLI artifact verification passed under Node $($node20.Version): npm install, bin/version/help, required files, redaction, strict options, and server filtering."
