[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string[]]$Path,

    [string]$PublicCertificatePath,

    [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$certificateSubject = "CN=MCPMender Community Build"
$certificateFriendlyName = "MCPMender Community Build (self-signed)"
$codeSigningEku = "1.3.6.1.5.5.7.3.3"
$minimumRemainingLifetime = (Get-Date).AddDays(30)

function Get-MCPMenderSigningCertificate {
    $existing = Get-ChildItem -Path Cert:\CurrentUser\My |
        Where-Object {
            $_.Subject -eq $certificateSubject -and
            $_.FriendlyName -eq $certificateFriendlyName -and
            $_.HasPrivateKey -and
            $_.NotAfter -gt $minimumRemainingLifetime -and
            (@($_.EnhancedKeyUsageList | ForEach-Object { [string]$_.ObjectId }) -contains $codeSigningEku)
        } |
        Sort-Object -Property NotAfter -Descending |
        Select-Object -First 1

    if ($null -ne $existing) {
        Write-Host "Reusing CurrentUser code-signing certificate $($existing.Thumbprint)."
        return $existing
    }

    Write-Host "Creating a non-exportable CurrentUser code-signing certificate."
    return New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certificateSubject `
        -FriendlyName $certificateFriendlyName `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyAlgorithm RSA `
        -KeyLength 3072 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy NonExportable `
        -KeyUsage DigitalSignature `
        -NotAfter (Get-Date).AddYears(3)
}

function Set-MCPMenderAuthenticodeSignature {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [Parameter(Mandatory = $true)]
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
    )

    $timestampApplied = $false
    if (-not [string]::IsNullOrWhiteSpace($TimestampServer)) {
        try {
            $null = Set-AuthenticodeSignature `
                -LiteralPath $LiteralPath `
                -Certificate $Certificate `
                -HashAlgorithm SHA256 `
                -TimestampServer $TimestampServer `
                -ErrorAction Stop

            $timestampApplied = $null -ne (Get-AuthenticodeSignature -LiteralPath $LiteralPath).TimeStamperCertificate
            if (-not $timestampApplied) {
                Write-Warning "The timestamp service returned no usable timestamp for '$LiteralPath'. Retrying without a timestamp."
            }
        }
        catch {
            Write-Warning "Timestamp signing failed for '$LiteralPath': $($_.Exception.Message)"
            Write-Warning "Retrying with a SHA-256 signature that has no trusted timestamp."
        }
    }

    if (-not $timestampApplied) {
        $null = Set-AuthenticodeSignature `
            -LiteralPath $LiteralPath `
            -Certificate $Certificate `
            -HashAlgorithm SHA256 `
            -ErrorAction Stop
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $LiteralPath
    if ($null -eq $signature.SignerCertificate) {
        throw "Signing did not produce an Authenticode signer for '$LiteralPath'."
    }
    if ($signature.Status -in @("HashMismatch", "NotSigned", "NotSupported", "Incompatible")) {
        throw "Signing produced an unusable Authenticode signature on '$LiteralPath' (status: $($signature.Status))."
    }
    if ($signature.SignerCertificate.Thumbprint -ne $Certificate.Thumbprint) {
        throw "The signer thumbprint on '$LiteralPath' does not match the selected certificate."
    }

    # NotTrusted is expected for a self-signed certificate. The presence and
    # thumbprint of SignerCertificate are the authoritative checks here.
    Write-Host ("Signed {0} (status: {1}, signer: {2}, timestamp: {3})." -f
        $LiteralPath,
        $signature.Status,
        $signature.SignerCertificate.Thumbprint,
        $(if ($null -ne $signature.TimeStamperCertificate) { "yes" } else { "no" }))
}

$resolvedExecutables = foreach ($candidate in $Path) {
    $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction Stop
    $item = Get-Item -LiteralPath $resolved.Path
    if ($item.PSIsContainer -or $item.Extension -ine ".exe") {
        throw "Only existing Windows .exe files can be signed: '$candidate'."
    }
    $item.FullName
}

$certificate = Get-MCPMenderSigningCertificate

if (-not [string]::IsNullOrWhiteSpace($PublicCertificatePath)) {
    $certificateOutput = [System.IO.Path]::GetFullPath($PublicCertificatePath)
    $certificateDirectory = Split-Path -Parent $certificateOutput
    if (-not [string]::IsNullOrWhiteSpace($certificateDirectory)) {
        New-Item -ItemType Directory -Force -Path $certificateDirectory | Out-Null
    }
    Export-Certificate -Cert $certificate -FilePath $certificateOutput -Force | Out-Null
    Write-Host "Exported public certificate only (no private key): $certificateOutput"
}

foreach ($executable in $resolvedExecutables) {
    Set-MCPMenderAuthenticodeSignature -LiteralPath $executable -Certificate $certificate
}

Write-Host "MCPMender community signing certificate thumbprint: $($certificate.Thumbprint)"
Write-Warning "This certificate was not added to any trusted root store. Windows SmartScreen or publisher warnings can still appear."
