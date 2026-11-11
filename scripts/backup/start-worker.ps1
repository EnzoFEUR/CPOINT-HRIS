$ErrorActionPreference = 'Stop'
$workerScript = Join-Path $PSScriptRoot 'worker.mjs'
$sourceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$workerState = Join-Path $env:USERPROFILE '.config\cpoint-hris-backup'
if ($env:HRIS_BACKUP_STATE_DIR) { $workerState = $env:HRIS_BACKUP_STATE_DIR }
if (-not (Test-Path -LiteralPath (Join-Path $workerState 'config.json'))) { throw 'Backup computer setup is incomplete.' }
$pidFile = Join-Path $workerState 'worker.pid'
if (Test-Path -LiteralPath $pidFile) {
    $workerProcessId = 0
    if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$workerProcessId)) {
        $existingWorker = Get-CimInstance Win32_Process -Filter "ProcessId=$workerProcessId" -ErrorAction SilentlyContinue
        if ($existingWorker -and $existingWorker.Name -eq 'node.exe' -and $existingWorker.CommandLine.Contains($workerScript)) {
            Write-Output 'The backup computer is already connected.'
            exit 0
        }
    }
}
$nodeExecutable = (Get-Command node.exe).Source
$workerProcess = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $workerScript + '"') -WorkingDirectory $sourceRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $workerState 'worker.log') -RedirectStandardError (Join-Path $workerState 'worker-errors.log')
Set-Content -LiteralPath $pidFile -Value $workerProcess.Id -NoNewline
Write-Output 'Backup computer connection started.'
