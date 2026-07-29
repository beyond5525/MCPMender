[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$expectedProjectRoot = [System.IO.Path]::GetFullPath("H:\MCPulse")
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspaceManifest = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$workspaceManifest.version
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$releaseDirectory = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "MCPMender"))
$expectedReleaseDirectory = [System.IO.Path]::GetFullPath("H:\MCPulse\release\MCPMender")
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "MCPMender.zip"))
$packWorkDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "work\release-pack"))

if (-not [string]::Equals($projectRoot.TrimEnd("\"), $expectedProjectRoot.TrimEnd("\"), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "This release script is pinned to '$expectedProjectRoot'; actual project root is '$projectRoot'."
}
if (-not [string]::Equals($releaseDirectory.TrimEnd("\"), $expectedReleaseDirectory.TrimEnd("\"), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to rebuild an unexpected release directory: '$releaseDirectory'."
}
if ($version -notmatch "^\d+\.\d+\.\d+-beta\.\d+$") {
    throw "Release version '$version' is not a supported beta version."
}
if ($SkipBuild) {
    throw "-SkipBuild is disabled for public releases because it can reuse stale desktop or CLI artifacts."
}

function Invoke-ProjectPnpm {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & (Join-Path $projectRoot "tools\dev.ps1") @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')"
    }
}

function Copy-ReleaseArtifact {
    param(
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$Source,
        [Parameter(Mandatory = $true)][string]$DestinationDirectory
    )

    New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
    Copy-Item -LiteralPath $Source.FullName -Destination (Join-Path $DestinationDirectory $Source.Name)
}

function Get-RelativeReleasePath {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$TargetPath
    )

    $baseUri = [System.Uri]($BasePath.TrimEnd("\") + "\")
    $targetUri = [System.Uri]$TargetPath
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace("/", "\")
}

function New-PortableReleaseZip {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDirectory,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open(
        $DestinationPath,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        foreach ($file in Get-ChildItem -LiteralPath $SourceDirectory -File -Recurse) {
            $relativePath = (
                Get-RelativeReleasePath -BasePath $SourceDirectory -TargetPath $file.FullName
            ).Replace("\", "/")
            $entryName = "MCPMender/$relativePath"
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $file.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Assert-ReleaseGitState {
    param(
        [string]$ExpectedHead
    )

    $workingTreeChanges = @(& git -C $projectRoot status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect the Git working tree."
    }
    if ($workingTreeChanges.Count -gt 0) {
        throw "Release builds require a clean Git working tree. Commit the intended source first."
    }

    $headOutput = @(& git -C $projectRoot rev-parse --verify HEAD)
    if ($LASTEXITCODE -ne 0 -or $headOutput.Count -ne 1) {
        throw "Unable to resolve the release Git commit."
    }
    $currentHead = $headOutput[0].Trim()
    if ($currentHead -notmatch "^[0-9a-fA-F]{40,64}$") {
        throw "Git returned an invalid HEAD value: '$currentHead'."
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedHead) -and $currentHead -ne $ExpectedHead) {
        throw "HEAD changed during the release build (expected $ExpectedHead, found $currentHead)."
    }

    $tagsAtHead = @(& git -C $projectRoot tag --points-at HEAD)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect Git tags at HEAD."
    }
    $matchingTags = @($tagsAtHead | Where-Object { $_.Trim() -eq "v$version" })
    if ($matchingTags.Count -ne 1) {
        throw "HEAD $currentHead must have the exact release tag 'v$version' before packaging."
    }

    return $currentHead
}

$headSha = Assert-ReleaseGitState

if (Test-Path -LiteralPath $packWorkDirectory) {
    $expectedWorkRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "work"))
    if (-not $packWorkDirectory.StartsWith($expectedWorkRoot.TrimEnd("\") + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear unexpected pack work directory '$packWorkDirectory'."
    }
    Remove-Item -LiteralPath $packWorkDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $packWorkDirectory | Out-Null

Invoke-ProjectPnpm -Arguments @("--filter", "@mcpmender/core", "build")
Invoke-ProjectPnpm -Arguments @("test")
Invoke-ProjectPnpm -Arguments @("typecheck")
Invoke-ProjectPnpm -Arguments @("--filter", "@mcpmender/desktop", "build")
Invoke-ProjectPnpm -Arguments @(
    "--filter", "@mcpmender/desktop", "exec",
    "electron-builder", "--win", "--x64", "--dir"
)
Invoke-ProjectPnpm -Arguments @("--filter", "mcpmender", "build")

$packStartedUtc = [DateTime]::UtcNow
Invoke-ProjectPnpm -Arguments @(
    "--dir", (Join-Path $projectRoot "packages\cli"),
    "pack",
    "--pack-destination", $packWorkDirectory
)

$packedArchives = @(Get-ChildItem -LiteralPath $packWorkDirectory -File -Filter "*.tgz")
$expectedCliPackageName = "mcpmender-$version.tgz"
if ($packedArchives.Count -ne 1 -or $packedArchives[0].Name -cne $expectedCliPackageName) {
    throw "The fresh pack directory must contain exactly '$expectedCliPackageName'; found: $(@($packedArchives.Name) -join ', ')."
}
$cliPackage = $packedArchives[0]
if ($cliPackage.LastWriteTimeUtc -lt $packStartedUtc.AddSeconds(-2)) {
    throw "CLI package '$($cliPackage.FullName)' is not from the current pack operation."
}

$licenseInventoryPath = Join-Path $packWorkDirectory "production-licenses.json"
$generatedNoticesPath = Join-Path $packWorkDirectory "THIRD_PARTY_NOTICES.generated.md"
$generatedSbomPath = Join-Path $packWorkDirectory "MCPMender.cdx.json"
& (Join-Path $projectRoot "tools\dev.ps1") licenses list --prod --json |
    Set-Content -LiteralPath $licenseInventoryPath -Encoding utf8
if ($LASTEXITCODE -ne 0) {
    throw "Unable to generate the production dependency license inventory."
}
Invoke-ProjectPnpm -Arguments @(
    "node",
    (Join-Path $projectRoot "tools\generate-compliance.mjs"),
    "--input", $licenseInventoryPath,
    "--sbom", $generatedSbomPath,
    "--notices", $generatedNoticesPath
)

$desktopArtifactDirectory = Join-Path $projectRoot "apps\desktop\release"
$windowsUnpackedDirectory = Join-Path $desktopArtifactDirectory "win-unpacked"
$windowsUnpackedExecutable = Join-Path $windowsUnpackedDirectory "MCPMender.exe"
if (-not (Test-Path -LiteralPath $windowsUnpackedExecutable -PathType Leaf)) {
    throw "No freshly built MCPMender $version Windows client was found in '$windowsUnpackedDirectory'."
}

& (Join-Path $projectRoot "tools\verify-cli-artifact.ps1") -PackagePath $cliPackage.FullName

# Builds and test tooling must not rewrite tracked source, move HEAD, or detach
# the release version from its exact tag.
$null = Assert-ReleaseGitState -ExpectedHead $headSha

if (Test-Path -LiteralPath $releaseDirectory) {
    Remove-Item -LiteralPath $releaseDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDirectory | Out-Null

$windowsReleaseDirectory = Join-Path $releaseDirectory "Windows\MCPMender"
New-Item -ItemType Directory -Force -Path $windowsReleaseDirectory | Out-Null
Copy-Item -Path (Join-Path $windowsUnpackedDirectory "*") -Destination $windowsReleaseDirectory -Recurse -Force
Copy-ReleaseArtifact -Source $cliPackage -DestinationDirectory (Join-Path $releaseDirectory "CLI")

$documentationDirectory = Join-Path $releaseDirectory "Documentation"
New-Item -ItemType Directory -Path $documentationDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "docs\MCPMender-Handbook.html") -Destination $documentationDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "CHANGELOG.md") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "PRIVACY.md") -Destination $releaseDirectory
Copy-Item -LiteralPath $generatedNoticesPath -Destination (Join-Path $releaseDirectory "THIRD_PARTY_NOTICES.md")
Copy-Item -LiteralPath $generatedSbomPath -Destination (Join-Path $releaseDirectory "MCPMender.cdx.json")
Copy-Item -LiteralPath (Join-Path $projectRoot "SIGNING.md") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "SECURITY.md") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "CONTRIBUTING.md") -Destination $releaseDirectory
$releaseReadmePath = Join-Path $releaseDirectory "README.md"
$releaseReadme = Get-Content -LiteralPath $releaseReadmePath -Raw
$releaseReadme = $releaseReadme.Replace(
    "(docs/MCPMender-Handbook.html)",
    "(Documentation/MCPMender-Handbook.html)"
)
Set-Content -LiteralPath $releaseReadmePath -Value $releaseReadme -Encoding utf8

Set-Content -LiteralPath (Join-Path $releaseDirectory "VERSION.txt") -Value $version -Encoding ascii
Set-Content `
    -LiteralPath (Join-Path $releaseDirectory "BUILD-INFO.json") `
    -Value (@{
        version = $version
        commit = $headSha
        tag = "v$version"
        builtAtUtc = [DateTime]::UtcNow.ToString("o")
        builderPlatform = "windows-x64"
    } | ConvertTo-Json) `
    -Encoding utf8

$releaseNotes = @"
MCPMender (Protocol Mender) $version

This is a beta release for local MCP configuration diagnostics, live connection
checks, and user-confirmed safe repairs. The desktop client supports English,
Simplified Chinese, and Japanese. The CLI package is in the CLI directory.

Windows: extract the archive and run Windows\MCPMender\MCPMender.exe.
Installation and single-file self-extraction are not required. Keeping the full
folder together lets MCPMender store normal runtime data beside the application
instead of using the system drive when that folder is writable.
CLI: install the .tgz with npm, then run "mcpmender --help".
Help: open Documentation\MCPMender-Handbook.html in a browser.

Platform validation:
- Windows x64 Desktop was built and smoke-tested natively on Windows.
- The CLI targets Node.js 20+ on Windows, macOS, and Linux.
- Native Linux and macOS Desktop packages are produced only by their matching
  CI runners and are not included in this Windows-built archive.

Source commit: $headSha
Source tag: v$version

The Windows EXE uses the self-signed "MCPMender Community Build" certificate.
It is signed for integrity and publisher fingerprint checking, but it is not a
commercially trusted certificate. Windows SmartScreen may still show a warning.
Read SIGNING.md before deciding whether to run the download.
"@
Set-Content -LiteralPath (Join-Path $releaseDirectory "RELEASE-NOTES.txt") -Value $releaseNotes -Encoding utf8

$windowsCopies = @(
    Get-Item -LiteralPath (Join-Path $windowsReleaseDirectory "MCPMender.exe")
)
& (Join-Path $projectRoot "tools\sign-windows-self-signed.ps1") `
    -Path $windowsCopies.FullName `
    -PublicCertificatePath (Join-Path $releaseDirectory "Certificates\MCPMender-Community-Build.cer") `
    -TimestampServer $TimestampServer

$releaseSigner = (Get-AuthenticodeSignature -LiteralPath $windowsCopies[0].FullName).SignerCertificate
if ($null -eq $releaseSigner) {
    throw "The signed Windows release has no signer certificate."
}
Set-Content `
    -LiteralPath (Join-Path $releaseDirectory "Certificates\MCPMender-Community-Build.thumbprint.txt") `
    -Value $releaseSigner.Thumbprint `
    -Encoding ascii

& (Join-Path $projectRoot "tools\smoke-windows-release.ps1") `
    -ExecutablePath $windowsCopies[0].FullName `
    -CaptureTarget main
& (Join-Path $projectRoot "tools\smoke-windows-release.ps1") `
    -ExecutablePath $windowsCopies[0].FullName `
    -CaptureTarget help `
    -CapturePath "F:\GemeHuanJing\MCPMenderTools\temp\mcpmender-release-help-smoke.png"

$checksumPath = Join-Path $releaseDirectory "SHA256SUMS.txt"
$checksumLines = Get-ChildItem -LiteralPath $releaseDirectory -File -Recurse |
    Where-Object { $_.FullName -ne $checksumPath } |
    Sort-Object -Property FullName |
    ForEach-Object {
        $relativePath = (Get-RelativeReleasePath -BasePath $releaseDirectory -TargetPath $_.FullName).Replace("\", "/")
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $relativePath"
    }
Set-Content -LiteralPath $checksumPath -Value $checksumLines -Encoding ascii

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
$archiveCreated = $false
for ($attempt = 1; $attempt -le 5 -and -not $archiveCreated; $attempt++) {
    try {
        New-PortableReleaseZip -SourceDirectory $releaseDirectory -DestinationPath $zipPath
        $archiveCreated = $true
    }
    catch {
        if ($attempt -ge 5) {
            throw
        }
        Write-Warning "A freshly signed file is temporarily busy; retrying archive creation ($attempt/5)."
        if (Test-Path -LiteralPath $zipPath) {
            Remove-Item -LiteralPath $zipPath -Force
        }
        Start-Sleep -Seconds 2
    }
}

& (Join-Path $projectRoot "tools\verify-release.ps1") -ReleaseDirectory $releaseDirectory -ZipPath $zipPath

Write-Host "Release folder: $releaseDirectory"
Write-Host "Release archive: $zipPath"
