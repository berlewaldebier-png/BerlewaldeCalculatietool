$ErrorActionPreference = "Stop"

$pythonExe = "C:\Users\hansh\AppData\Local\Programs\Python\Python313\python.exe"
$scriptPath = "C:\Users\hansh\.codex\CalculatieTool\scripts\run_regression_checks.py"

if (-not (Test-Path $pythonExe)) {
    throw "Python niet gevonden op $pythonExe"
}

& $pythonExe $scriptPath
