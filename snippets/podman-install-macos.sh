#!/bin/bash
# Install Podman Desktop on macOS (silently via Homebrew)
set -euo pipefail

echo "==> Installing Podman Desktop on macOS..."

# Install Homebrew if not present
if ! command -v brew &>/dev/null; then
  echo "    Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install Podman and Podman Desktop
echo "    Installing Podman..."
brew install podman

echo "    Installing Podman Desktop..."
brew install --cask podman-desktop

# Initialize Podman machine
echo "    Initializing Podman machine..."
podman machine init 2>/dev/null || true
podman machine start 2>/dev/null || true

echo "==> Podman Desktop installed successfully!"
echo "    Version: $(podman --version)"
