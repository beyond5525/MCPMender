[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExecutablePath,

    [string]$CapturePath = "F:\GemeHuanJing\MCPMenderTools\temp\mcpmender-release-smoke.png",

    [ValidateSet("main", "help")]
    [string]$CaptureTarget = "main",

    [ValidateRange(5, 120)]
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
if ([System.IO.Path]::GetExtension($resolvedExecutable) -ine ".exe") {
    throw "The Windows smoke-test target must be an EXE."
}

function Get-TargetProcessIds {
    $ids = [System.Collections.Generic.List[int]]::new()
    foreach ($candidate in @(Get-Process -ErrorAction SilentlyContinue)) {
        try {
            if ([string]::Equals($candidate.Path, $resolvedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
                $ids.Add($candidate.Id)
            }
        }
        catch {
            # Protected system processes can deny access to Path; they cannot be
            # this user-launched release executable.
        }
        finally {
            $candidate.Dispose()
        }
    }
    return @($ids)
}

$resolvedCapture = [System.IO.Path]::GetFullPath($CapturePath)
$captureDirectory = Split-Path -Parent $resolvedCapture
New-Item -ItemType Directory -Force -Path $captureDirectory | Out-Null
if (Test-Path -LiteralPath $resolvedCapture) {
    Remove-Item -LiteralPath $resolvedCapture -Force
}

$runId = [Guid]::NewGuid().ToString("N")
$runRoot = [System.IO.Path]::GetFullPath((Join-Path $captureDirectory "mcpmender-smoke-$CaptureTarget-$runId"))
$dataDirectory = Join-Path $runRoot "data"
$runtimeTemp = Join-Path $runRoot "temp"
New-Item -ItemType Directory -Force -Path $dataDirectory, $runtimeTemp | Out-Null
$baselineProcessIds = [System.Collections.Generic.HashSet[int]]::new()
foreach ($baselineProcessId in @(Get-TargetProcessIds)) {
    [void]$baselineProcessIds.Add($baselineProcessId)
}

$previousCapturePath = $env:MCPMENDER_CAPTURE_PATH
$previousCaptureTarget = $env:MCPMENDER_CAPTURE_TARGET
$previousDataDir = $env:MCPMENDER_DATA_DIR
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$process = $null
try {
    $env:MCPMENDER_CAPTURE_PATH = $resolvedCapture
    $env:MCPMENDER_CAPTURE_TARGET = if ($CaptureTarget -eq "help") { "help" } else { $null }
    $env:MCPMENDER_DATA_DIR = $dataDirectory
    $env:TEMP = $runtimeTemp
    $env:TMP = $runtimeTemp

    $process = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $resolvedCapture -PathType Leaf)) {
        if ($process.HasExited) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $resolvedCapture -PathType Leaf)) {
        throw "MCPMender did not produce a $CaptureTarget UI capture within $TimeoutSeconds seconds (process exited: $($process.HasExited))."
    }

    $remainingMilliseconds = [Math]::Max(1, [int][Math]::Ceiling(($deadline - [DateTime]::UtcNow).TotalMilliseconds))
    if (-not $process.HasExited -and -not $process.WaitForExit($remainingMilliseconds)) {
        throw "MCPMender produced the $CaptureTarget capture but did not exit within $TimeoutSeconds seconds."
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "MCPMender $CaptureTarget smoke process exited with code $($process.ExitCode)."
    }

    # Allow Electron child processes a brief graceful shutdown window, then
    # reject any new process still running from this exact release executable.
    $residualProcessIds = @()
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $residualProcessIds = @(
            Get-TargetProcessIds | Where-Object { -not $baselineProcessIds.Contains($_) }
        )
        if ($residualProcessIds.Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 200
    }
    if ($residualProcessIds.Count -gt 0) {
        throw "MCPMender left release processes running after smoke capture: $($residualProcessIds -join ', ')."
    }

    $capture = Get-Item -LiteralPath $resolvedCapture
    Start-Sleep -Milliseconds 200
    $stableCapture = Get-Item -LiteralPath $resolvedCapture
    if ($capture.Length -ne $stableCapture.Length -or $capture.LastWriteTimeUtc -ne $stableCapture.LastWriteTimeUtc) {
        throw "MCPMender UI capture was still being written after the smoke process exited."
    }
    $capture = $stableCapture
    if ($capture.Length -lt 1024) {
        throw "MCPMender produced an unexpectedly small UI capture ($($capture.Length) bytes)."
    }

    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::FromFile($resolvedCapture)
    try {
        $colors = [System.Collections.Generic.HashSet[int]]::new()
        $xStep = [Math]::Max(1, [int]($bitmap.Width / 48))
        $yStep = [Math]::Max(1, [int]($bitmap.Height / 32))
        for ($y = 0; $y -lt $bitmap.Height; $y += $yStep) {
            for ($x = 0; $x -lt $bitmap.Width; $x += $xStep) {
                [void]$colors.Add($bitmap.GetPixel($x, $y).ToArgb())
            }
        }
        if ($colors.Count -lt 8) {
            throw "MCPMender produced a visually blank UI capture ($($colors.Count) sampled colors)."
        }
    }
    finally {
        $bitmap.Dispose()
    }

    Write-Host "Windows $CaptureTarget UI smoke test passed: $resolvedCapture ($($capture.Length) bytes, $($colors.Count) sampled colors, clean exit)."
}
finally {
    if ($null -ne $process) {
        $process.Dispose()
    }
    foreach ($residualProcessId in @(Get-TargetProcessIds | Where-Object { -not $baselineProcessIds.Contains($_) })) {
        Stop-Process -Id $residualProcessId -Force -ErrorAction SilentlyContinue
    }
    $env:MCPMENDER_CAPTURE_PATH = $previousCapturePath
    $env:MCPMENDER_CAPTURE_TARGET = $previousCaptureTarget
    $env:MCPMENDER_DATA_DIR = $previousDataDir
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
    if (Test-Path -LiteralPath $runRoot) {
        Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
