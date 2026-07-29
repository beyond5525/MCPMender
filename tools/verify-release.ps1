[CmdletBinding()]
param(
    [string]$ReleaseDirectory = "H:\MCPulse\release\MCPMender",
    [string]$ZipPath = "H:\MCPulse\release\MCPMender.zip"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspaceManifest = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$expectedVersion = [string]$workspaceManifest.version
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

function Assert-SafeRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,

        [Parameter(Mandatory = $true)]
        [string]$Context
    )

    if ([string]::IsNullOrWhiteSpace($RelativePath) -or $RelativePath.IndexOf([char]0) -ge 0) {
        throw "$Context contains an empty or NUL path."
    }
    if ($RelativePath.Contains("\")) {
        throw "$Context must use forward slashes only: '$RelativePath'."
    }
    if ([System.IO.Path]::IsPathRooted($RelativePath) -or
        $RelativePath.StartsWith("/", [System.StringComparison]::Ordinal) -or
        $RelativePath.Contains(":")) {
        throw "$Context contains a rooted or drive-like path: '$RelativePath'."
    }

    $segments = @($RelativePath.Split("/"))
    if ($segments.Count -eq 0 -or @($segments | Where-Object { $_ -eq "" -or $_ -eq "." -or $_ -eq ".." }).Count -gt 0) {
        throw "$Context contains an empty, current-directory, or parent-directory segment: '$RelativePath'."
    }
}

function Assert-CodeSigningCertificate {
    param(
        [Parameter(Mandatory = $true)]
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,

        [Parameter(Mandatory = $true)]
        [string]$Context
    )

    $expectedSubject = "CN=MCPMender Community Build"
    $codeSigningEku = "1.3.6.1.5.5.7.3.3"
    $now = Get-Date
    if ($Certificate.Subject -ne $expectedSubject) {
        throw "$Context has unexpected subject '$($Certificate.Subject)'."
    }
    if ($Certificate.Issuer -ne $Certificate.Subject) {
        throw "$Context is not self-signed (issuer '$($Certificate.Issuer)')."
    }
    if ($Certificate.NotBefore -gt $now -or $Certificate.NotAfter -le $now) {
        throw "$Context is outside its validity period ($($Certificate.NotBefore.ToUniversalTime().ToString('o')) to $($Certificate.NotAfter.ToUniversalTime().ToString('o')))."
    }
    $ekuObjectIds = @($Certificate.EnhancedKeyUsageList | ForEach-Object { [string]$_.ObjectId })
    if ($ekuObjectIds -notcontains $codeSigningEku) {
        throw "$Context does not include the Code Signing EKU ($codeSigningEku)."
    }
}

$requiredFiles = @(
    "VERSION.txt",
    "RELEASE-NOTES.txt",
    "BUILD-INFO.json",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "PRIVACY.md",
    "THIRD_PARTY_NOTICES.md",
    "MCPMender.cdx.json",
    "SIGNING.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "SHA256SUMS.txt",
    "Documentation\MCPMender-Handbook.html",
    "Certificates\MCPMender-Community-Build.cer",
    "Certificates\MCPMender-Community-Build.thumbprint.txt",
    "CLI\mcpmender-$expectedVersion.tgz",
    "Windows\MCPMender\MCPMender.exe"
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
$buildInfo = Get-Content -LiteralPath (Join-Path $resolvedReleaseDirectory "BUILD-INFO.json") -Raw | ConvertFrom-Json
if ($buildInfo.version -ne $expectedVersion -or $buildInfo.tag -ne "v$expectedVersion") {
    throw "BUILD-INFO.json does not identify the expected version and tag."
}
$workingTreeChanges = @(& git -C $projectRoot status --porcelain)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect the Git working tree while verifying the release."
}
if ($workingTreeChanges.Count -gt 0) {
    throw "Release verification requires a clean Git working tree."
}
$currentCommitOutput = @(& git -C $projectRoot rev-parse --verify HEAD)
if ($LASTEXITCODE -ne 0 -or $currentCommitOutput.Count -ne 1) {
    throw "Unable to resolve the current Git commit."
}
$currentCommit = $currentCommitOutput[0].Trim()
if ($currentCommit -notmatch "^[0-9a-fA-F]{40,64}$") {
    throw "Git returned an invalid HEAD value: '$currentCommit'."
}
if ($buildInfo.commit -ne $currentCommit) {
    throw "Release commit '$($buildInfo.commit)' does not match current HEAD '$currentCommit'."
}
$tagsAtHead = @(& git -C $projectRoot tag --points-at HEAD)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect Git tags while verifying the release."
}
$tagAtHead = @($tagsAtHead | Where-Object { $_.Trim() -eq "v$expectedVersion" })
if ($tagAtHead.Count -ne 1) {
    throw "Current HEAD is not tagged v$expectedVersion."
}

$sbom = Get-Content -LiteralPath (Join-Path $resolvedReleaseDirectory "MCPMender.cdx.json") -Raw | ConvertFrom-Json
if ($sbom.bomFormat -ne "CycloneDX" -or $sbom.specVersion -ne "1.6") {
    throw "The release SBOM is not CycloneDX 1.6."
}
if (@($sbom.components).Count -lt 1) {
    throw "The release SBOM has no production dependency components."
}

$windowsExecutables = @(
    Get-Item -LiteralPath (Join-Path $resolvedReleaseDirectory "Windows\MCPMender\MCPMender.exe")
)
if ($windowsExecutables.Count -eq 0) {
    throw "No MCPMender $expectedVersion Windows portable EXE is present."
}
$publicCertificate = Get-PfxCertificate -FilePath (Join-Path $resolvedReleaseDirectory "Certificates\MCPMender-Community-Build.cer")
Assert-CodeSigningCertificate -Certificate $publicCertificate -Context "Published certificate"
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
    $signatureStatus = $signature.Status.ToString()
    $isExpectedUntrustedRoot =
        $signatureStatus -eq "UnknownError" -and
        $signature.StatusMessage -match "(?i)(root certificate.+not trusted|untrustedroot)"
    if ($signatureStatus -notin @("Valid", "NotTrusted") -and -not $isExpectedUntrustedRoot) {
        throw "Windows EXE has an unacceptable Authenticode signature: '$($executable.Name)' (status: $signatureStatus)."
    }
    Assert-CodeSigningCertificate -Certificate $signature.SignerCertificate -Context "Signer on '$($executable.Name)'"
    if ($signature.SignerCertificate.Thumbprint -ne $publishedThumbprint) {
        throw "Signer thumbprint mismatch on '$($executable.Name)'."
    }
    Write-Host "Signature present on $($executable.Name): status=$($signature.Status), thumbprint=$($signature.SignerCertificate.Thumbprint)"
}

$checksumPath = Join-Path $resolvedReleaseDirectory "SHA256SUMS.txt"
$manifestEntries = [System.Collections.Generic.Dictionary[string, bool]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($line in Get-Content -LiteralPath $checksumPath) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }
    if ($line -notmatch "^([0-9a-fA-F]{64})  (.+)$") {
        throw "Malformed SHA256SUMS line: '$line'."
    }

    $expectedHash = $Matches[1].ToLowerInvariant()
    $relativePath = $Matches[2]
    Assert-SafeRelativePath -RelativePath $relativePath -Context "SHA256SUMS"
    if ($manifestEntries.ContainsKey($relativePath)) {
        throw "SHA256SUMS contains a duplicate or case-conflicting path: '$relativePath'."
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
    $manifestEntries.Add($relativePath, $true)
}

$filesThatRequireChecksums = Get-ChildItem -LiteralPath $resolvedReleaseDirectory -File -Recurse |
    Where-Object { $_.FullName -ne $checksumPath }
foreach ($file in $filesThatRequireChecksums) {
    $relativePath = (Get-RelativeReleasePath -BasePath $resolvedReleaseDirectory -TargetPath $file.FullName).Replace("\", "/")
    if (-not $manifestEntries.ContainsKey($relativePath)) {
        throw "Release file is missing from SHA256SUMS: '$relativePath'."
    }
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedZipPath)
try {
    $zipEntriesByName = [System.Collections.Generic.Dictionary[string, System.IO.Compression.ZipArchiveEntry]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $releaseFiles = @(Get-ChildItem -LiteralPath $resolvedReleaseDirectory -File -Recurse)
    $expectedZipFiles = [System.Collections.Generic.Dictionary[string, System.IO.FileInfo]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $expectedZipDirectories = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    [void]$expectedZipDirectories.Add("MCPMender/")
    foreach ($releaseFile in $releaseFiles) {
        $relativePath = (Get-RelativeReleasePath -BasePath $resolvedReleaseDirectory -TargetPath $releaseFile.FullName).Replace("\", "/")
        $requiredZipEntry = "MCPMender/$relativePath"
        $expectedZipFiles.Add($requiredZipEntry, $releaseFile)

        $directoryName = [System.IO.Path]::GetDirectoryName($relativePath.Replace("/", "\"))
        while (-not [string]::IsNullOrWhiteSpace($directoryName)) {
            [void]$expectedZipDirectories.Add("MCPMender/$($directoryName.Replace('\', '/'))/")
            $directoryName = [System.IO.Path]::GetDirectoryName($directoryName)
        }
    }

    foreach ($entry in $archive.Entries) {
        $rawEntryName = $entry.FullName
        if ([string]::IsNullOrWhiteSpace($rawEntryName) -or $rawEntryName.IndexOf([char]0) -ge 0) {
            throw "Release ZIP contains an empty or NUL entry name."
        }
        if ($rawEntryName.Contains("\")) {
            throw "Release ZIP entry must use forward slashes only: '$rawEntryName'."
        }

        $isDirectoryEntry = $rawEntryName.EndsWith("/", [System.StringComparison]::Ordinal)
        $pathToValidate = if ($isDirectoryEntry) { $rawEntryName.TrimEnd("/") } else { $rawEntryName }
        Assert-SafeRelativePath -RelativePath $pathToValidate -Context "Release ZIP"
        if ($zipEntriesByName.ContainsKey($rawEntryName)) {
            throw "Release ZIP contains a duplicate or case-conflicting entry: '$rawEntryName'."
        }
        $zipEntriesByName.Add($rawEntryName, $entry)

        if ($isDirectoryEntry) {
            if (-not $expectedZipDirectories.Contains($rawEntryName)) {
                throw "Release ZIP contains an unexpected directory entry: '$rawEntryName'."
            }
            if ($entry.Length -ne 0) {
                throw "Release ZIP directory entry has non-zero content: '$rawEntryName'."
            }
            continue
        }
        if (-not $expectedZipFiles.ContainsKey($rawEntryName)) {
            throw "Release ZIP contains an unexpected file entry: '$rawEntryName'."
        }
        $expectedCasing = @($expectedZipFiles.Keys | Where-Object { $_ -ieq $rawEntryName })[0]
        if ($rawEntryName -cne $expectedCasing) {
            throw "Release ZIP entry casing differs from the release tree: '$rawEntryName' versus '$expectedCasing'."
        }
    }
    if ($zipEntriesByName.Count -eq 0) {
        throw "Release ZIP is empty."
    }

    foreach ($requiredZipEntry in $expectedZipFiles.Keys) {
        if (-not $zipEntriesByName.ContainsKey($requiredZipEntry)) {
            throw "Release ZIP is readable but is missing '$requiredZipEntry'."
        }
        $zipEntry = $zipEntriesByName[$requiredZipEntry]
        $releaseFile = $expectedZipFiles[$requiredZipEntry]
        if ($zipEntry.Length -ne $releaseFile.Length) {
            throw "Release ZIP entry size mismatch for '$requiredZipEntry'."
        }

        $entryStream = $zipEntry.Open()
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $zipHash = [System.BitConverter]::ToString($sha256.ComputeHash($entryStream)).Replace("-", "").ToLowerInvariant()
        }
        finally {
            $sha256.Dispose()
            $entryStream.Dispose()
        }
        $releaseHash = (Get-FileHash -LiteralPath $releaseFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($zipHash -ne $releaseHash) {
            throw "Release ZIP entry content SHA-256 mismatch for '$requiredZipEntry'."
        }
    }
}
finally {
    $archive.Dispose()
}

Write-Host "Verified MCPMender $expectedVersion release directory, signatures, SHA-256 manifest, and ZIP structure."
Write-Warning "A NotTrusted Authenticode status is expected for the self-signed community certificate and does not mean the EXE is unsigned."
