$ErrorActionPreference = 'Stop'
$workerStarter = Join-Path $PSScriptRoot 'start-worker.ps1'
$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'C-Point Backup Computer.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$expectedArguments = '-NoProfile -WindowStyle Hidden -File "' + $workerStarter + '"'
if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.Arguments -ne $expectedArguments) { throw 'An existing startup shortcut differs. It was preserved.' }
$shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
$shortcut.Arguments = $expectedArguments
$shortcut.WorkingDirectory = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$shortcut.WindowStyle = 7
$shortcut.Description = 'Connect this approved PC to administrator backup requests.'
$shortcut.Save()
& $workerStarter
Write-Output 'The backup computer will connect automatically when this Windows user signs in.'
