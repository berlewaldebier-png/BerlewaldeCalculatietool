param(
    [string]$Host = $env:CALCULATIETOOL_REMOTE_HOST,
    [string]$User = $env:CALCULATIETOOL_REMOTE_USER,
    [string]$RemoteAppDir = $env:CALCULATIETOOL_REMOTE_APP_DIR,
    [int]$Port = $(if ($env:CALCULATIETOOL_REMOTE_PORT) { [int]$env:CALCULATIETOOL_REMOTE_PORT } else { 22 }),
    [string]$KeyPath = $env:CALCULATIETOOL_SSH_KEY,
    [string]$LocalAppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Test-RequiredTool {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Benodigde tool '$Name' is niet gevonden in PATH."
    }
}

function New-SshArgumentList {
    param(
        [string]$ToolName,
        [int]$PortNumber,
        [string]$PrivateKeyPath
    )

    $args = @()
    if ($ToolName -eq "scp") {
        $args += "-P"
    } else {
        $args += "-p"
    }
    $args += "$PortNumber"

    if ($PrivateKeyPath) {
        if (-not (Test-Path $PrivateKeyPath)) {
            throw "SSH key niet gevonden: $PrivateKeyPath"
        }
        $args += "-i"
        $args += $PrivateKeyPath
    }

    return ,$args
}

if (-not $Host -or -not $User -or -not $RemoteAppDir) {
    throw "Host, User en RemoteAppDir zijn verplicht. Gebruik parameters of zet CALCULATIETOOL_REMOTE_HOST, CALCULATIETOOL_REMOTE_USER en CALCULATIETOOL_REMOTE_APP_DIR."
}

Test-RequiredTool -Name "scp"

$localDataDir = Join-Path $LocalAppDir "data"
if (-not (Test-Path $localDataDir)) {
    throw "Lokale data-map niet gevonden: $localDataDir"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $LocalAppDir "backups\data-sync\$timestamp"
$localBackupDir = Join-Path $backupRoot "local-before-pull"
$downloadDir = Join-Path $backupRoot "remote-download"
$remoteDataDir = "$RemoteAppDir/data"

New-Item -ItemType Directory -Force -Path $localBackupDir | Out-Null
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null

Copy-Item -Path (Join-Path $localDataDir "*.json") -Destination $localBackupDir -Force -ErrorAction SilentlyContinue

$scpArgs = New-SshArgumentList -ToolName "scp" -PortNumber $Port -PrivateKeyPath $KeyPath
$scpArgs += "$User@$Host`:$remoteDataDir/*.json"
$scpArgs += $downloadDir

Write-Host "Download remote data from $User@$Host:$remoteDataDir"
& scp @scpArgs
if ($LASTEXITCODE -ne 0) {
    throw "scp download mislukt."
}

$downloadedFiles = Get-ChildItem -Path $downloadDir -Filter "*.json" -File
if (-not $downloadedFiles) {
    throw "Er zijn geen JSON-bestanden gedownload uit $remoteDataDir"
}

Copy-Item -Path (Join-Path $downloadDir "*.json") -Destination $localDataDir -Force

Write-Host ""
Write-Host "Sync voltooid."
Write-Host "Lokale backup: $localBackupDir"
Write-Host "Gedownloade data: $downloadDir"
