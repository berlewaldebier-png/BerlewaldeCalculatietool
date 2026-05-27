$ErrorActionPreference = "Stop"

param(
  [string]$BaseUrl = "http://localhost:3000/api",
  [ValidateSet("all", "year_setup")]
  [string]$Mode = "all",
  [ValidateSet("", "demo_foundation", "demo_full")]
  [string]$SeedProfile = "demo_full",
  [int]$TimeoutSeconds = 60
)

$username = $env:TEST_USERNAME
$password = $env:TEST_PASSWORD

if (-not $username -or -not $password) {
  throw "Zet TEST_USERNAME en TEST_PASSWORD environment variabelen."
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "Login as $username..."
$loginBody = @{ username = $username; password = $password } | ConvertTo-Json
$loginResp = Invoke-WebRequest -Method Post -Uri "$BaseUrl/auth/login" -Body $loginBody -ContentType "application/json" -WebSession $session -TimeoutSec $TimeoutSeconds
if ($loginResp.StatusCode -ne 200) {
  throw "Login failed: HTTP $($loginResp.StatusCode)"
}

Write-Host "Dev reset: mode=$Mode seed_profile=$SeedProfile"
$seedParam = ""
if ($SeedProfile) { $seedParam = "&seed_profile=$([Uri]::EscapeDataString($SeedProfile))" }
$resetResp = Invoke-WebRequest -Method Post -Uri "$BaseUrl/meta/dev/reset?mode=$Mode$seedParam" -WebSession $session -TimeoutSec $TimeoutSeconds

Write-Host "OK"
$resetResp.Content

