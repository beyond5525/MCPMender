[CmdletBinding()]
param(
    [string]$ReleaseDirectory = "H:\MCPulse\release\MCPMender",
    [string]$ZipPath = "H:\MCPulse\release\MCPMender.zip"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression.FileSystem

$expectedVersion = "0.3.0-beta.1"
$expectedReleaseDirectory = [System.IO.Path]::GetFullPath("H:\MCPulse\release\MCPMender")
$resolvedReleaseDirectory = [System.IO.Path]::GetFullPath($ReleaseDirectory)
$resolvedZipPath = [System.IO.Path]::GetFullPath($ZipPath)

if (-not [string]::Equals($resolvedReleaseDirectory.TrimEnd("\"), $expectedReleaseDirectory.TrimEnd("\"), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to verify an unexpected release directory: '$resolvedReleaseDirectory'."
}
if (-not (Test-Path -LiteralPath $resolvedReleaseDirectory -PathType Container)) {
    throw "Release directory does not exist: '$resolvedReleaseDirectory'."
}
if (-not (Test-Path -LiteralPath $resolvedZipPath -PathType Leaf)) {
    throw "Release ZIP does not exist: '$resolvedZipPath'."
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

$requiredFiles = @(
    "VERSION.txt",
    "RELEASE-NOTES.txt",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "PRIVACY.md",
    "THIRD_PARTY_NOTICES.md",
    "SIGNING.md",
    "SHA256SUMS.txt",
    "Documentation\MCPMender-Handbook.html",
    "Certificates\MCPMender-Community-Build.cer",
    "Certificates\MCPMender-Community-Build.thumbprint.txt",
    "CLI\mcpmender-$expectedVersion.tgz"
)
foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $resolvedReleaseDirectory $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Required release file is missing: '$relativePath'."
    }
}

$version = (Get-Content -LiteralPath (Join-Path $resolvedReleaseDirectory "VERSION.txt") -Raw).Trim()
if ($version -ne $expectedVersion) {
    throw "VERSION.txt contains '$version'; expected '$expectedVersion'."
}

$windowsExecutables = @(
    Get-ChildItem -LiteralPath $resolvedReleaseDirectory -File |
        Where-Object { $_.Name -like "MCPMender-$expectedVersion-Windows-*.exe" }
)
if ($windowsExecutables.Count -eq 0) {
    throw "No MCPMender $expectedVersion Windows portable EXE is present."
}
$publicCertificate = Get-PfxCertificate -FilePath (Join-Path $resolvedReleaseDirectory "Certificates\MCPMender-Community-Build.cer")
$publishedThumbprint = (
    Get-Content -LiteralPath (Join-Path $resolvedReleaseDirectory "Certificates\MCPMender-Community-Build.thumbprint.txt") -Raw
).Trim()
if ($publicCertificate.Thumbprint -ne $publishedThumbprint) {
    throw "The published certificate thumbprint does not match the included public certificate."
}
foreach ($executable in $windowsExecutables) {
    $signature = Get-AuthenticodeSignature -LiteralPath $executable.FullName
    if ($null -eq $signature.SignerCertificate) {
        throw "Windows EXE has no Authenticode signer: '$($executable.Name)'."
    }
    if ($signature.Status -in @("HashMismatch", "NotSigned", "NotSupported", "Incompatible")) {
        throw "Windows EXE has an unusable Authenticode signature: '$($executable.Name)' (status: $($signature.Status))."
    }
    if ($signature.SignerCertificate.Subject -ne "CN=MCPMender Community Build") {
        throw "Unexpected Windows signer on '$($executable.Name)': '$($signature.SignerCertificate.Subject)'."
    }
    if ($signature.SignerCertificate.Thumbprint -ne $publishedThumbprint) {
        throw "Signer thumbprint mismatch on '$($executable.Name)'."
    }
    Write-Host "Signature present on $($executable.Name): status=$($signature.Status), thumbprint=$($signature.SignerCertificate.Thumbprint)"
}

$checksumPath = Join-Path $resolvedReleaseDirectory "SHA256SUMS.txt"
$manifestEntries = @{}
foreach ($line in Get-Content -LiteralPath $checksumPath) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }
    if ($line -notmatch "^([0-9a-fA-F]{64})  (.+)$") {
        throw "Malformed SHA256SUMS line: '$line'."
    }

    $expectedHash = $Matches[1].ToLowerInvariant()
    $relativePath = $Matches[2]
    if ([System.IO.Path]::IsPathRooted($relativePath) -or $relativePath -match "(^|/)\.\.(/|$)") {
        throw "Unsafe path in SHA256SUMS: '$relativePath'."
    }

    $normalizedRelativePath = $relativePath.Replace("/", "\")
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $resolvedReleaseDirectory $normalizedRelativePath))
    if (-not $filePath.StartsWith($resolvedReleaseDirectory.TrimEnd("\") + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Checksum path escapes the release directory: '$relativePath'."
    }
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        throw "Checksum entry points to a missing file: '$relativePath'."
    }

    $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "SHA-256 mismatch for '$relativePath'."
    }
    $manifestEntries[$relativePath.ToLowerInvariant()] = $true
}

$filesThatRequireChecksums = Get-ChildItem -LiteralPath $resolvedReleaseDirectory -File -Recurse |
    Where-Object { $_.FullName -ne $checksumPath }
foreach ($file in $filesThatRequireChecksums) {
    $relativePath = (Get-RelativeReleasePath -BasePath $resolvedReleaseDirectory -TargetPath $file.FullName).Replace("\", "/").ToLowerInvariant()
    if (-not $manifestEntries.ContainsKey($relativePath)) {
        throw "Release file is missing from SHA256SUMS: '$relativePath'."
    }
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedZipPath)
try {
    $zipEntriesByName = @{}
    foreach ($entry in $archive.Entries) {
        $normalizedEntryName = $entry.FullName.Replace("\", "/")
        if ($zipEntriesByName.ContainsKey($normalizedEntryName)) {
            throw "Release ZIP contains a duplicate entry: '$normalizedEntryName'."
        }
        $zipEntriesByName[$normalizedEntryName] = $entry
    }
    $entryNames = @($zipEntriesByName.Keys)
    if ($entryNames.Count -eq 0) {
        throw "Release ZIP is empty."
    }
    if (@($entryNames | Where-Object { -not $_.StartsWith("MCPMender/", [System.StringComparison]::Ordinal) }).Count -gt 0) {
        throw "Release ZIP contains entries outside the top-level MCPMender folder."
    }

    $releaseFiles = Get-ChildItem -LiteralPath $resolvedReleaseDirectory -File -Recurse
    foreach ($releaseFile in $releaseFiles) {
        $relativePath = (Get-RelativeReleasePath -BasePath $resolvedReleaseDirectory -TargetPath $releaseFile.FullName).Replace("\", "/")
        $requiredZipEntry = "MCPMender/$relativePath"
        if (-not $zipEntriesByName.ContainsKey($requiredZipEntry)) {
            throw "Release ZIP is readable but is missing '$requiredZipEntry'."
        }
        $zipEntry = $zipEntriesByName[$requiredZipEntry]
        if ($zipEntry.Length -ne $releaseFile.Length) {
            throw "Release ZIP entry size mismatch for '$requiredZipEntry'."
        }
    }
}
finally {
    $archive.Dispose()
}

Write-Host "Verified MCPMender $expectedVersion release directory, signatures, SHA-256 manifest, and ZIP structure."
Write-Warning "A NotTrusted Authenticode status is expected for the self-signed community certificate and does not mean the EXE is unsigned."
