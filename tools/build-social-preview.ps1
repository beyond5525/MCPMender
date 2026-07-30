[CmdletBinding()]
param(
    [string]$BackgroundPath,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ([string]::IsNullOrWhiteSpace($BackgroundPath)) {
    $BackgroundPath = Join-Path $projectRoot "docs\marketing\social-preview-background.png"
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $projectRoot "docs\marketing\mcpmender-social-preview.jpg"
}

$resolvedBackground = [System.IO.Path]::GetFullPath($BackgroundPath)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$logoPath = Join-Path $projectRoot "apps\desktop\assets\brand\mcpmender-icon.png"

if (-not (Test-Path -LiteralPath $resolvedBackground -PathType Leaf)) {
    throw "Social preview background is missing: '$resolvedBackground'."
}
if (-not (Test-Path -LiteralPath $logoPath -PathType Leaf)) {
    throw "MCPMender logo is missing: '$logoPath'."
}

$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

function New-RoundedRectanglePath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $diameter = $Radius * 2
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc(
        $X + $Width - $diameter,
        $Y + $Height - $diameter,
        $diameter,
        $diameter,
        0,
        90
    )
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function ConvertFrom-Base64Utf8 {
    param([Parameter(Mandatory = $true)][string]$Value)

    return [System.Text.Encoding]::UTF8.GetString(
        [System.Convert]::FromBase64String($Value)
    )
}

$editionText = ConvertFrom-Base64Utf8 `
    "5Y2P6K6u5L+u5YygIMK3IOODl+ODreODiOOCs+ODq+S/ruW+qQ=="
$languageText = ConvertFrom-Base64Utf8 `
    "RU4gwrcg566A5LitIMK3IOaXpeacrOiqng=="

$canvas = [System.Drawing.Bitmap]::new(1280, 640)
$canvas.SetResolution(96, 96)
$background = [System.Drawing.Image]::FromFile($resolvedBackground)
$logo = [System.Drawing.Image]::FromFile($logoPath)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)

$titleFont = [System.Drawing.Font]::new(
    "Segoe UI",
    42,
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
)
$editionFont = [System.Drawing.Font]::new(
    "Segoe UI",
    18,
    [System.Drawing.FontStyle]::Regular,
    [System.Drawing.GraphicsUnit]::Pixel
)
$taglineFont = [System.Drawing.Font]::new(
    "Segoe UI",
    34,
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
)
$bodyFont = [System.Drawing.Font]::new(
    "Segoe UI",
    19,
    [System.Drawing.FontStyle]::Regular,
    [System.Drawing.GraphicsUnit]::Pixel
)
$chipFont = [System.Drawing.Font]::new(
    "Segoe UI",
    16,
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
)
$footerFont = [System.Drawing.Font]::new(
    "Segoe UI",
    15,
    [System.Drawing.FontStyle]::Regular,
    [System.Drawing.GraphicsUnit]::Pixel
)

$whiteBrush = [System.Drawing.SolidBrush]::new(
    [System.Drawing.Color]::FromArgb(246, 249, 255)
)
$mutedBrush = [System.Drawing.SolidBrush]::new(
    [System.Drawing.Color]::FromArgb(169, 193, 220)
)
$accentBrush = [System.Drawing.SolidBrush]::new(
    [System.Drawing.Color]::FromArgb(71, 229, 204)
)
$chipBrush = [System.Drawing.SolidBrush]::new(
    [System.Drawing.Color]::FromArgb(156, 8, 34, 52)
)
$chipBorderPen = [System.Drawing.Pen]::new(
    [System.Drawing.Color]::FromArgb(125, 69, 222, 202),
    1
)

try {
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $graphics.DrawImage(
        $background,
        [System.Drawing.Rectangle]::new(0, 0, 1280, 640)
    )

    $graphics.DrawImage(
        $logo,
        [System.Drawing.Rectangle]::new(68, 54, 104, 104)
    )
    $graphics.DrawString("MCPMender", $titleFont, $whiteBrush, 188, 61)
    $graphics.DrawString(
        $editionText,
        $editionFont,
        $mutedBrush,
        191,
        113
    )

    $graphics.FillRectangle($accentBrush, 72, 205, 64, 5)
    $graphics.DrawString(
        "Find broken MCP configurations.",
        $taglineFont,
        $whiteBrush,
        72,
        229
    )
    $graphics.DrawString(
        "Repair them safely.",
        $taglineFont,
        $accentBrush,
        72,
        278
    )
    $graphics.DrawString(
        "Local diagnostics, live handshake checks, automatic backups, and rollback.",
        $bodyFont,
        $mutedBrush,
        [System.Drawing.RectangleF]::new(73, 344, 690, 58)
    )

    $chips = @(
        @{ Text = "Desktop + CLI"; Width = 158 },
        @{ Text = "Windows | macOS | Linux"; Width = 251 },
        @{ Text = $languageText; Width = 180 }
    )
    $chipX = 72
    foreach ($chip in $chips) {
        $chipPath = New-RoundedRectanglePath `
            -X $chipX `
            -Y 430 `
            -Width $chip.Width `
            -Height 42 `
            -Radius 14
        try {
            $graphics.FillPath($chipBrush, $chipPath)
            $graphics.DrawPath($chipBorderPen, $chipPath)
            $graphics.DrawString(
                $chip.Text,
                $chipFont,
                $whiteBrush,
                [System.Drawing.RectangleF]::new($chipX + 15, 440, $chip.Width - 30, 25)
            )
        }
        finally {
            $chipPath.Dispose()
        }
        $chipX += $chip.Width + 14
    }

    $graphics.DrawString(
        "Open source | Local only | No account | No telemetry",
        $footerFont,
        $mutedBrush,
        73,
        548
    )
    $graphics.DrawString(
        "github.com/beyond5525/MCPMender",
        $footerFont,
        $whiteBrush,
        73,
        580
    )

    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq "image/jpeg" } |
        Select-Object -First 1
    $encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
    $qualityParameter = [System.Drawing.Imaging.EncoderParameter]::new(
        [System.Drawing.Imaging.Encoder]::Quality,
        [long]92
    )
    $encoderParameters.Param[0] = $qualityParameter
    try {
        $canvas.Save($resolvedOutput, $jpegCodec, $encoderParameters)
    }
    finally {
        $qualityParameter.Dispose()
        $encoderParameters.Dispose()
    }
}
finally {
    $chipBorderPen.Dispose()
    $chipBrush.Dispose()
    $accentBrush.Dispose()
    $mutedBrush.Dispose()
    $whiteBrush.Dispose()
    $footerFont.Dispose()
    $chipFont.Dispose()
    $bodyFont.Dispose()
    $taglineFont.Dispose()
    $editionFont.Dispose()
    $titleFont.Dispose()
    $graphics.Dispose()
    $logo.Dispose()
    $background.Dispose()
    $canvas.Dispose()
}

$outputInfo = Get-Item -LiteralPath $resolvedOutput
if ($outputInfo.Length -ge 1MB) {
    throw "Social preview exceeds GitHub's 1 MB recommendation: $($outputInfo.Length) bytes."
}

Write-Host "Built social preview: '$resolvedOutput' ($($outputInfo.Length) bytes)."
