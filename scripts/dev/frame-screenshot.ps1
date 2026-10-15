# Make the README screenshot: frame a raw 2x app capture (from scripts/dev/cdp.mjs
# 'shot2x') in a stylised window. Example:
#   powershell -File scripts/dev/frame-screenshot.ps1 -In raw.png -Out docs/screenshot.png -Transparent
# Wrap a raw app screenshot in a stylised window: title bar with traffic-light
# buttons, rounded corners, soft shadow, gradient backdrop.
param([string]$In, [string]$Out, [double]$FinalScale = 0.6, [switch]$Transparent)

Add-Type -AssemblyName System.Drawing
$shot = [System.Drawing.Image]::FromFile($In)

$k = 2.0                       # the capture is at 2x
$pad = if ($Transparent) { [int](40 * $k) } else { [int](90 * $k) }
$titleH = [int](38 * $k)
$radius = [int](12 * $k)
$winW = $shot.Width
$winH = $shot.Height + $titleH
$W = $winW + 2 * $pad
$H = $winH + 2 * $pad

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
$g.TextRenderingHint = 'AntiAliasGridFit'

# Backdrop: diagonal indigo -> teal gradient.
$bgRect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
if (-not $Transparent) {
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bgRect, ([System.Drawing.Color]::FromArgb(255, 67, 56, 202)), ([System.Drawing.Color]::FromArgb(255, 13, 148, 136)), 35.0
  $g.FillRectangle($bg, $bgRect)
}

function RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Soft shadow: stacked translucent rounded rects, offset downwards.
for ($i = 40; $i -ge 1; $i--) {
  $spread = $i * 1.6 * $k / 2
  $alpha = [int](5 * (1 - $i / 41.0) + 1)
  $sp = RoundedPath ($pad - $spread) ($pad - $spread + 14 * $k) ($winW + 2 * $spread) ($winH + 2 * $spread) ($radius + $spread)
  $sb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, 0, 0, 0))
  $g.FillPath($sb, $sp)
}

# Window body, clipped to rounded corners.
$win = RoundedPath $pad $pad $winW $winH $radius
$g.SetClip($win)
$titleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 44, 44, 50))
$g.FillRectangle($titleBrush, $pad, $pad, $winW, $titleH)
$g.DrawImage($shot, $pad, $pad + $titleH, $shot.Width, $shot.Height)
# Hairline under the title bar.
$line = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 30, 30, 34)), (1 * $k)
$g.DrawLine($line, $pad, $pad + $titleH, $pad + $winW, $pad + $titleH)
$g.ResetClip()

# Traffic-light buttons.
$colors = @(@(255, 95, 87), @(254, 188, 46), @(40, 200, 64))
$dot = 12 * $k
for ($i = 0; $i -lt 3; $i++) {
  $c = $colors[$i]
  $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $c[0], $c[1], $c[2]))
  $g.FillEllipse($b, $pad + (14 + $i * 20) * $k, $pad + ($titleH - $dot) / 2, $dot, $dot)
}

# Centered title.
$font = New-Object System.Drawing.Font 'Segoe UI Semibold', (10.5 * $k), ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Point)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 200, 200, 208))
$g.DrawString('Leanlings', $font, $textBrush, (New-Object System.Drawing.RectangleF $pad, $pad, $winW, $titleH), $fmt)

# Subtle outline around the window.
$outline = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 255, 255, 255)), (1 * $k)
$g.DrawPath($outline, $win)
$g.Dispose()

# Downscale for the README.
$fw = [int]($W * $FinalScale); $fh = [int]($H * $FinalScale)
$final = New-Object System.Drawing.Bitmap $fw, $fh
$g2 = [System.Drawing.Graphics]::FromImage($final)
$g2.InterpolationMode = 'HighQualityBicubic'
$g2.SmoothingMode = 'AntiAlias'
$g2.PixelOffsetMode = 'HighQuality'
$g2.DrawImage($bmp, 0, 0, $fw, $fh)
$g2.Dispose()
$final.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$shot.Dispose(); $bmp.Dispose(); $final.Dispose()
"saved $Out ($fw x $fh, $([math]::Round((Get-Item $Out).Length / 1KB)) KB)"
