# Install Podman Desktop on Windows (silently via winget)
# Requires: Windows 10+

Write-Host "==> Installing Podman Desktop on Windows..."

# Try winget first
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "    Installing Podman via winget..."
    winget install -e --id RedHat.Podman --accept-source-agreements --accept-package-agreements
    winget install -e --id RedHat.Podman-Desktop --accept-source-agreements --accept-package-agreements
} else {
    # Fallback: download installer directly
    $TempDir = Join-Path $env:TEMP "podman-install"
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

    Write-Host "    Downloading Podman Desktop installer..."
    $InstallerUrl = "https://github.com/containers/podman-desktop/releases/latest/download/podman-desktop-setup.exe"
    $InstallerPath = Join-Path $TempDir "podman-desktop-setup.exe"
    Invoke-WebRequest -Uri $InstallerUrl -OutFile $InstallerPath -UseBasicParsing

    Write-Host "    Installing Podman Desktop (silent)..."
    Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -NoNewWindow

    Remove-Item -Recurse -Force $TempDir
}

Write-Host "==> Podman Desktop installed successfully!"
Write-Host "    You may need to restart your computer."
