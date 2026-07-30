[CmdletBinding()]
param(
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseExecutable = Join-Path $projectRoot "apps\desktop\release\win-unpacked\MCPMender.exe"
if (-not (Test-Path -LiteralPath $releaseExecutable -PathType Leaf)) {
    throw "The freshly built Windows executable is missing: '$releaseExecutable'."
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectRoot "docs\screenshots"
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

$driveRoot = [System.IO.Path]::GetPathRoot($projectRoot)
$fixtureRoot = [System.IO.Path]::GetFullPath((Join-Path $driveRoot "MCPMenderDemo"))
if (Test-Path -LiteralPath $fixtureRoot) {
    throw "Refusing to reuse the public screenshot fixture path: '$fixtureRoot'."
}

$profileRoot = Join-Path $fixtureRoot "User"
$appData = Join-Path $profileRoot "AppData\Roaming"
$dataDirectory = Join-Path $fixtureRoot "Data"
$codexDirectory = Join-Path $profileRoot ".codex"
$claudeDirectory = Join-Path $appData "Claude"

$previousCaptureLocale = $env:MCPMENDER_CAPTURE_LOCALE
try {
    New-Item -ItemType Directory -Force -Path $codexDirectory, $claudeDirectory, $dataDirectory | Out-Null

    @'
[mcp_servers.local_docs]
command = "cmd"
args = ["/d", "/s", "/c", "echo", "MCPMender demo server"]
'@ | Set-Content -LiteralPath (Join-Path $codexDirectory "config.toml") -Encoding utf8

    @'
{
  "mcpServers": {
    "team-tools": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "H:\\DemoWorkspace"],
      "env": {
        "PATH": "H:\\MCPMenderDemo\\NoExecutables"
      }
    }
  }
}
'@ | Set-Content -LiteralPath (Join-Path $claudeDirectory "claude_desktop_config.json") -Encoding utf8

    $captures = @(
        @{ Locale = "en"; Slug = "en" },
        @{ Locale = "zh-CN"; Slug = "zh-cn" },
        @{ Locale = "ja"; Slug = "ja" }
    )
    foreach ($capture in $captures) {
        $env:MCPMENDER_CAPTURE_LOCALE = $capture.Locale
        foreach ($target in @("main", "help")) {
            & (Join-Path $PSScriptRoot "smoke-windows-release.ps1") `
                -ExecutablePath $releaseExecutable `
                -CaptureTarget $target `
                -CapturePath (Join-Path $resolvedOutput "$($capture.Slug)-$target.png") `
                -UserProfilePath $profileRoot `
                -DataDirectory $dataDirectory
        }
    }
}
finally {
    $env:MCPMENDER_CAPTURE_LOCALE = $previousCaptureLocale
    $resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
    $expectedFixture = [System.IO.Path]::GetFullPath((Join-Path $driveRoot "MCPMenderDemo"))
    if (
        [string]::Equals(
            $resolvedFixture,
            $expectedFixture,
            [System.StringComparison]::OrdinalIgnoreCase
        ) -and
        (Split-Path -Leaf $resolvedFixture) -eq "MCPMenderDemo" -and
        (Test-Path -LiteralPath $resolvedFixture)
    ) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}

Write-Host "Generated trilingual release gallery in '$resolvedOutput'."
