# Install Docker Desktop on Windows (silently)
# Requires: Windows 10+, WSL2 or Hyper-V

Write-Host "==> Installing Docker Desktop on Windows..."

$TempDir = Join-Path $env:TEMP "docker-install"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$InstallerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
$InstallerPath = Join-Path $TempDir "DockerDesktopInstaller.exe"

Write-Host "    Downloading Docker Desktop..."
Invoke-WebRequest -Uri $InstallerUrl -OutFile $InstallerPath -UseBasicParsing

Write-Host "    Installing Docker Desktop (silent)..."
Start-Process -FilePath $InstallerPath -ArgumentList "install", "--quiet", "--accept-license" -Wait -NoNewWindow

Write-Host "    Cleaning up..."
Remove-Item -Recurse -Force $TempDir

Write-Host "==> Docker Desktop installed successfully!"
Write-Host "    You may need to restart your computer."
Write-Host "    After restart, Docker Desktop will start automatically."
