# One-time installer for a new Windows machine. Downloads the signed .xpi
# builds from this repo's GitHub Pages site and hands them to Firefox to
# install. You still have to click "Add" on Firefox's own install prompt
# once per extension -- that confirmation can't be scripted around. After
# this, each extension's own update_url keeps it current automatically;
# you don't need to re-run this except on a machine that's never had it.

$ErrorActionPreference = "Stop"

$BaseUrl = "https://iancox-cmyk.github.io/ext-updates"
$TmpDir = Join-Path $env:TEMP ("ext-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $TmpDir | Out-Null

$Extensions = @(
    "modo-bot/modo-bot-1.16.xpi",
    "autoclicker/simple-autoclicker-2.3.xpi"
)

function Find-Firefox {
    $candidates = @(
        "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
        "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    $cmd = Get-Command firefox.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$firefoxPath = Find-Firefox

Write-Host "Downloading extensions from $BaseUrl ..."
$localFiles = @()
foreach ($path in $Extensions) {
    $fname = Split-Path $path -Leaf
    $dest = Join-Path $TmpDir $fname
    Write-Host "  -> $fname"
    Invoke-WebRequest -Uri "$BaseUrl/$path" -OutFile $dest
    $hash = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
    Write-Host "     sha256: $hash"
    $localFiles += $dest
}

Write-Host ""
if ($firefoxPath) {
    Write-Host 'Opening each in Firefox - click "Add" on the install prompt for each.'
    foreach ($f in $localFiles) {
        Start-Process -FilePath $firefoxPath -ArgumentList "`"$f`""
        Start-Sleep -Seconds 2
    }
} else {
    Write-Host "Couldn't find firefox.exe automatically. Open these files with Firefox manually (drag onto the window, or File > Open File):"
    $localFiles | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
Write-Host "Done. Updates will arrive automatically from here on."
