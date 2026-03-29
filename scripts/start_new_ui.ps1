$ErrorActionPreference = "Stop"

$repoRoot = "C:\Users\hansh\.codex\CalculatieTool"
$frontendDir = Join-Path $repoRoot "frontend"
$backendDir = Join-Path $repoRoot "backend"
$backendEnvScript = Join-Path $backendDir ".env.local.ps1"
$pythonExe = "C:\Users\hansh\AppData\Local\Programs\Python\Python313\python.exe"
$npmCmd = "C:\Program Files\nodejs\npm.cmd"

function Stop-PortProcess {
    param(
        [int]$Port
    )

    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq "Listen" } |
        Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($processId in $connections) {
        try {
            Stop-Process -Id $processId -Force -ErrorAction Stop
            Write-Host "Poort $Port vrijgemaakt (PID $processId gestopt)."
        }
        catch {
            Write-Warning "Kon proces op poort $Port niet stoppen: $processId"
        }
    }
}

Write-Host "Oude processen op poort 3000 en 8000 opruimen..."
Stop-PortProcess -Port 3000
Stop-PortProcess -Port 8000

Write-Host "Frontend production build maken..."
Push-Location $frontendDir
try {
    $env:PATH = "C:\Program Files\nodejs;$env:PATH"
    & $npmCmd run build
}
finally {
    Pop-Location
}

if (Test-Path $backendEnvScript) {
    Write-Host "Lokale backend-env geladen uit $backendEnvScript"
}

Write-Host "Backend starten op http://127.0.0.1:8000 ..."
Start-Process powershell `
    -ArgumentList "-NoExit", "-Command", "cd '$backendDir'; if (Test-Path '$backendEnvScript') { . '$backendEnvScript' }; & '$pythonExe' -m uvicorn app.main:app --reload --port 8000"

Start-Sleep -Seconds 2

Write-Host "Frontend starten op http://localhost:3000 ..."
Start-Process powershell `
    -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; `$env:PATH='C:\Program Files\nodejs;' + `$env:PATH; & '$npmCmd' run start"

Write-Host ""
Write-Host "Nieuwe UI gestart."
Write-Host "Frontend: http://localhost:3000"
Write-Host "Backend:  http://127.0.0.1:8000"
