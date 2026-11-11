$ErrorActionPreference = 'Stop'
$backupTools = Join-Path $env:LOCALAPPDATA 'CPoint-HRIS-Backup'
New-Item -ItemType Directory -Path $backupTools -Force | Out-Null
$archive = Join-Path $backupTools 'restic_0.19.1_windows_amd64.zip'
$expected = 'da948ad707ed690426473aaba2046cd61f8f90f6f0e7dab6be0d5796531de67d'
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_windows_amd64.zip' -OutFile $archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Official restic archive checksum mismatch. Nothing will be executed.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $backupTools -Force
$executable = Join-Path $backupTools 'restic.exe'
$versioned = Join-Path $backupTools 'restic_0.19.1_windows_amd64.exe'
if (Test-Path -LiteralPath $versioned) { Copy-Item -LiteralPath $versioned -Destination $executable -Force }
& $executable version
if ($LASTEXITCODE -ne 0) { throw 'restic executable verification failed.' }
Write-Output 'Pinned, checksum-verified restic is available for the backup operator. No system PATH changes made.'
