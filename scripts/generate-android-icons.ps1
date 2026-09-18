param(
    [string]$Source = "",
    [string]$StoreOutput = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Source) {
    $Source = Join-Path $projectRoot "assets/icon-512.png"
}
if (-not $StoreOutput) {
    $StoreOutput = Join-Path $projectRoot "store-assets/google-play/icon-512.png"
}

Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
if ($sourceImage.Width -ne 512 -or $sourceImage.Height -ne 512) {
    $sourceImage.Dispose()
    throw "Android icon source must be exactly 512 x 512 pixels: $sourcePath"
}

$background = [System.Drawing.Color]::FromArgb(255, 250, 250, 250)
$pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
$pngFormat = [System.Drawing.Imaging.ImageFormat]::Png

function Set-HighQualityGraphics([System.Drawing.Graphics]$graphics) {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
}

function Save-ScaledIcon(
    [string]$OutputPath,
    [int]$Size,
    [double]$Scale,
    [bool]$Round
) {
    $renderSize = $Size * 4
    $renderBitmap = New-Object System.Drawing.Bitmap($renderSize, $renderSize, $pixelFormat)
    $renderGraphics = [System.Drawing.Graphics]::FromImage($renderBitmap)
    Set-HighQualityGraphics $renderGraphics
    $renderGraphics.Clear([System.Drawing.Color]::Transparent)

    if ($Round) {
        $clipPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $clipPath.AddEllipse(2, 2, $renderSize - 4, $renderSize - 4)
        $renderGraphics.SetClip($clipPath)
        $renderGraphics.Clear($background)
    } else {
        $renderGraphics.Clear($background)
    }

    $drawSize = [int][Math]::Round($renderSize * $Scale)
    $drawOffset = [int][Math]::Round(($renderSize - $drawSize) / 2)
    $destination = New-Object System.Drawing.Rectangle($drawOffset, $drawOffset, $drawSize, $drawSize)
    $renderGraphics.DrawImage($sourceImage, $destination)

    if ($Round) {
        $renderGraphics.ResetClip()
        $clipPath.Dispose()
    }
    $renderGraphics.Dispose()

    $outputBitmap = New-Object System.Drawing.Bitmap($Size, $Size, $pixelFormat)
    $outputGraphics = [System.Drawing.Graphics]::FromImage($outputBitmap)
    Set-HighQualityGraphics $outputGraphics
    $outputGraphics.Clear([System.Drawing.Color]::Transparent)
    $outputGraphics.DrawImage($renderBitmap, (New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)))
    $outputGraphics.Dispose()
    $renderBitmap.Dispose()

    $directory = Split-Path -Parent $OutputPath
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $outputBitmap.Save($OutputPath, $pngFormat)
    $outputBitmap.Dispose()
}

$legacySizes = [ordered]@{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
}

$foregroundSizes = [ordered]@{
    "mipmap-mdpi" = 108
    "mipmap-hdpi" = 162
    "mipmap-xhdpi" = 216
    "mipmap-xxhdpi" = 324
    "mipmap-xxxhdpi" = 432
}

$resourceRoot = Join-Path $projectRoot "android/app/src/main/res"
foreach ($entry in $legacySizes.GetEnumerator()) {
    $directory = Join-Path $resourceRoot $entry.Key
    Save-ScaledIcon (Join-Path $directory "ic_launcher.png") $entry.Value 1.0 $false
    Save-ScaledIcon (Join-Path $directory "ic_launcher_round.png") $entry.Value 0.84 $true
}

foreach ($entry in $foregroundSizes.GetEnumerator()) {
    $directory = Join-Path $resourceRoot $entry.Key
    # Android adaptive icons use a 108dp canvas. Keeping the complete source at
    # 74% places the calligraphy and flower inside the common mask safe zone.
    Save-ScaledIcon (Join-Path $directory "ic_launcher_foreground.png") $entry.Value 0.74 $false
}

# Google Play requires a separate 512px, 32-bit PNG. This deliberately keeps
# the approved artwork unchanged and only normalizes the pixel format.
Save-ScaledIcon $StoreOutput 512 1.0 $false

$sourceImage.Dispose()

Write-Output "Android launcher icons generated from $sourcePath"
Write-Output "Google Play icon generated at $StoreOutput"
