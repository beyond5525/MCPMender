[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExecutablePath,

    [string]$CapturePath = "F:\GemeHuanJing\MCPulseTools\temp\mcpmender-release-smoke.png",

    [ValidateRange(5, 120)]
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
if ([System.IO.Path]::GetExtension($resolvedExecutable) -ine ".exe") {
    throw "The Windows smoke-test target must be an EXE."
}

$resolvedCapture = [System.IO.Path]::GetFullPath($CapturePath)
$captureDirectory = Split-Path -Parent $resolvedCapture
New-Item -ItemType Directory -Force -Path $captureDirectory | Out-Null
if (Test-Path -LiteralPath $resolvedCapture) {
    Remove-Item -LiteralPath $resolvedCapture -Force
}

$previousCapturePath = $env:MCPMENDER_CAPTURE_PATH
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
try {
    $env:MCPMENDER_CAPTURE_PATH = $resolvedCapture
    $env:TEMP = $captureDirectory
    $env:TMP = $captureDirectory
    $process = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $resolvedCapture)) {
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $resolvedCapture -PathType Leaf)) {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
        }
        throw "MCPMender did not produce a UI capture within $TimeoutSeconds seconds."
    }
    $capture = Get-Item -LiteralPath $resolvedCapture
    if ($capture.Length -lt 1024) {
        throw "MCPMender produced an unexpectedly small UI capture ($($capture.Length) bytes)."
    }
    Write-Host "Windows release smoke test passed: $resolvedCapture ($($capture.Length) bytes)."
}
finally {
    $env:MCPMENDER_CAPTURE_PATH = $previousCapturePath
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
