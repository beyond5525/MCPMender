[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$version = "0.3.0-beta.1"
$expectedProjectRoot = [System.IO.Path]::GetFullPath("H:\MCPulse")
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
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

if (-not $SkipBuild) {
    Invoke-ProjectPnpm -Arguments @("--filter", "@mcpmender/desktop", "dist")
    Invoke-ProjectPnpm -Arguments @("--filter", "mcpmender", "build")

    if (Test-Path -LiteralPath $packWorkDirectory) {
        if (-not $packWorkDirectory.StartsWith([System.IO.Path]::GetFullPath((Join-Path $projectRoot "work")), [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clear unexpected pack work directory '$packWorkDirectory'."
        }
        Remove-Item -LiteralPath $packWorkDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $packWorkDirectory | Out-Null
    Invoke-ProjectPnpm -Arguments @(
        "--dir", (Join-Path $projectRoot "packages\cli"),
        "pack",
        "--pack-destination", $packWorkDirectory
    )
}

$desktopArtifactDirectory = Join-Path $projectRoot "apps\desktop\release"
$windowsArtifacts = @(
    Get-ChildItem -LiteralPath $desktopArtifactDirectory -File -ErrorAction Stop |
        Where-Object { $_.Name -like "MCPMender-$version-Windows-*.exe" }
)
if ($windowsArtifacts.Count -eq 0) {
    throw "No MCPMender $version Windows portable EXE was found in '$desktopArtifactDirectory'. Build it first or omit -SkipBuild."
}

$cliSearchRoots = @(
    $packWorkDirectory,
    $releaseRoot,
    (Join-Path $projectRoot "packages\cli")
)
$cliPackages = @(
    @(
        foreach ($searchRoot in $cliSearchRoots) {
            if (Test-Path -LiteralPath $searchRoot) {
                Get-ChildItem -LiteralPath $searchRoot -File |
                    Where-Object { $_.Name -eq "mcpmender-$version.tgz" }
            }
        }
    ) | Sort-Object -Property LastWriteTime -Descending
)
if ($cliPackages.Count -eq 0) {
    throw "No mcpmender-$version.tgz CLI package was found. Build it first or omit -SkipBuild."
}
$cliPackage = $cliPackages[0]

$optionalArtifacts = @(
    Get-ChildItem -LiteralPath $desktopArtifactDirectory -File |
        Where-Object {
            $_.Name -like "MCPMender-$version-macOS-*.dmg" -or
            $_.Name -like "MCPMender-$version-macOS-*.zip" -or
            $_.Name -like "MCPMender-$version-Linux-*.AppImage" -or
            $_.Name -like "MCPMender-$version-Linux-*.tar.gz"
        }
)

if (Test-Path -LiteralPath $releaseDirectory) {
    Remove-Item -LiteralPath $releaseDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDirectory | Out-Null

foreach ($artifact in $windowsArtifacts) {
    Copy-ReleaseArtifact -Source $artifact -DestinationDirectory $releaseDirectory
}
Copy-ReleaseArtifact -Source $cliPackage -DestinationDirectory (Join-Path $releaseDirectory "CLI")

foreach ($artifact in $optionalArtifacts) {
    $platformDirectory = if ($artifact.Name -like "*-macOS-*") { "macOS" } else { "Linux" }
    Copy-ReleaseArtifact -Source $artifact -DestinationDirectory (Join-Path $releaseDirectory $platformDirectory)
}

$documentationDirectory = Join-Path $releaseDirectory "Documentation"
New-Item -ItemType Directory -Path $documentationDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "docs\MCPMender-Handbook.html") -Destination $documentationDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "CHANGELOG.md") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "PRIVACY.md") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD_PARTY_NOTICES.md") -Destination $releaseDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "SIGNING.md") -Destination $releaseDirectory

Set-Content -LiteralPath (Join-Path $releaseDirectory "VERSION.txt") -Value $version -Encoding ascii

$releaseNotes = @"
MCPMender (Protocol Mender) $version

This is a beta release for local MCP configuration diagnostics, live connection
checks, and user-confirmed safe repairs. The desktop client supports English,
Simplified Chinese, and Japanese. The CLI package is in the CLI directory.

Windows: run the portable EXE; installation is not required.
CLI: install the .tgz with npm, then run "mcpmender --help".
Help: open Documentation\MCPMender-Handbook.html in a browser.

The Windows EXE uses the self-signed "MCPMender Community Build" certificate.
It is signed for integrity and publisher fingerprint checking, but it is not a
commercially trusted certificate. Windows SmartScreen may still show a warning.
Read SIGNING.md before deciding whether to run the download.
"@
Set-Content -LiteralPath (Join-Path $releaseDirectory "RELEASE-NOTES.txt") -Value $releaseNotes -Encoding utf8

$windowsCopies = @(
    Get-ChildItem -LiteralPath $releaseDirectory -File |
        Where-Object { $_.Name -like "MCPMender-$version-Windows-*.exe" }
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
    -ExecutablePath $windowsCopies[0].FullName

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
        Compress-Archive -LiteralPath $releaseDirectory -DestinationPath $zipPath -CompressionLevel Optimal
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
