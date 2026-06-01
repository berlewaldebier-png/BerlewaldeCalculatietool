$ErrorActionPreference = "Stop"

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$loginBody = @{ username = "admin"; password = "admin" } | ConvertTo-Json
Invoke-WebRequest `
  -Uri "http://localhost:3000/api/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $loginBody `
  -WebSession $session `
  -UseBasicParsing `
  | Out-Null

$url = "http://localhost:3000/api/meta/bootstrap?datasets=erp-dashboard&navigation=false&basis=invoice"
$resp = Invoke-WebRequest -Uri $url -WebSession $session -UseBasicParsing
$obj = $resp.Content | ConvertFrom-Json

$ds = $obj.datasets."erp-dashboard"
$rev = $ds.trends.revenue

Write-Host ("revenue points: {0}" -f $rev.Count)
Write-Host ("forecast points: {0}" -f (($rev | Where-Object { $_.forecast_ex -ne $null }).Count))

Write-Host "sample revenue:"
$rev | Select-Object -First 8 | ConvertTo-Json -Depth 5 | Write-Host
