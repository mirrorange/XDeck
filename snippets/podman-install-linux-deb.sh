#!/bin/bash
# Install Podman on Ubuntu/Debian
set -euo pipefail

echo "==> Installing Podman on Ubuntu/Debian..."

# Install Podman from default repositories (Ubuntu 22.04+ / Debian 11+)
sudo apt-get update
sudo apt-get install -y podman

# Install podman-compose
if command -v pip3 &>/dev/null; then
  pip3 install --user podman-compose
elif command -v pipx &>/dev/null; then
  pipx install podman-compose
else
  echo "    Note: Install pip3 or pipx to get podman-compose"
fi

echo "==> Podman installed successfully!"
echo "    Version: $(podman --version)"
