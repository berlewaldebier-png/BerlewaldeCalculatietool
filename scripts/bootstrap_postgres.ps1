$ErrorActionPreference = "Stop"

$repoRoot = "C:\Users\hansh\.codex\CalculatieTool"
$pythonExe = "C:\Users\hansh\AppData\Local\Programs\Python\Python313\python.exe"
$scriptPath = Join-Path $repoRoot "scripts\bootstrap_postgres.py"

if (-not (Test-Path $pythonExe)) {
    throw "Python niet gevonden op $pythonExe"
}

& $pythonExe $scriptPath
