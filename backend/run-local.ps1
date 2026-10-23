param([switch]$CreateSuperuser)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$backendRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonPath = Join-Path $backendRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Crie o ambiente virtual em backend/.venv e instale requirements.txt antes de iniciar.'
}

$databasePath = (Join-Path $backendRoot 'db.sqlite3').Replace('\', '/')
$env:DATABASE_URL = "sqlite:///$databasePath"
$env:DJANGO_DEBUG = 'true'

Push-Location $backendRoot
try {
    & $pythonPath manage.py migrate --noinput
    if ($LASTEXITCODE -ne 0) { throw 'A migração do banco local falhou.' }
    if ($CreateSuperuser) {
        & $pythonPath manage.py createsuperuser
    } else {
        & $pythonPath manage.py runserver 127.0.0.1:8000 --noreload
    }
} finally {
    Pop-Location
}
