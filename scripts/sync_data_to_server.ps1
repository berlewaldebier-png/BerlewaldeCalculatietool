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
Test-RequiredTool -Name "ssh"

$localDataDir = Join-Path $LocalAppDir "data"
if (-not (Test-Path $localDataDir)) {
    throw "Lokale data-map niet gevonden: $localDataDir"
}

$localFiles = Get-ChildItem -Path $localDataDir -Filter "*.json" -File
if (-not $localFiles) {
    throw "Geen lokale JSON-bestanden gevonden in $localDataDir"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $LocalAppDir "backups\data-sync\$timestamp"
$localBackupDir = Join-Path $backupRoot "local-before-push"
New-Item -ItemType Directory -Force -Path $localBackupDir | Out-Null
Copy-Item -Path (Join-Path $localDataDir "*.json") -Destination $localBackupDir -Force -ErrorAction SilentlyContinue

$remoteDataDir = "$RemoteAppDir/data"
$remoteBackupDir = "$RemoteAppDir/backups/data-sync/$timestamp"

$sshArgs = New-SshArgumentList -ToolName "ssh" -PortNumber $Port -PrivateKeyPath $KeyPath
$remoteCommand = "mkdir -p '$remoteBackupDir' && cp -r '$remoteDataDir'/ '$remoteBackupDir/server-before-push'"
$sshArgs += "$User@$Host"
$sshArgs += $remoteCommand

Write-Host "Maak remote backup op $User@$Host:$remoteBackupDir"
& ssh @sshArgs
if ($LASTEXITCODE -ne 0) {
    throw "Remote backup via ssh mislukt."
}

$scpArgs = New-SshArgumentList -ToolName "scp" -PortNumber $Port -PrivateKeyPath $KeyPath
$scpArgs += (Join-Path $localDataDir "*.json")
$scpArgs += "$User@$Host`:$remoteDataDir/"

Write-Host "Upload local data to $User@$Host:$remoteDataDir"
& scp @scpArgs
if ($LASTEXITCODE -ne 0) {
    throw "scp upload mislukt."
}

Write-Host ""
Write-Host "Sync voltooid."
Write-Host "Lokale backup: $localBackupDir"
Write-Host "Remote backup: $remoteBackupDir/server-before-push"
