# Creates a Start Menu shortcut so Math Sync launches like a normal desktop app.
# Remove by deleting: %APPDATA%\Microsoft\Windows\Start Menu\Programs\Math Sync.lnk
$app = Split-Path $PSScriptRoot -Parent
$lnkPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Math Sync.lnk"

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments = "`"$app\launcher.vbs`""
$lnk.WorkingDirectory = $app
$icon = Join-Path $app "public\icon.ico"
if (Test-Path $icon) { $lnk.IconLocation = $icon }
$lnk.Description = "On-device Gemma 4 math tutor (offline)"
$lnk.Save()

Write-Host "Created: $lnkPath"
