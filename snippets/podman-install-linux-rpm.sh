#!/bin/bash
# Install Podman on RHEL/CentOS/Fedora
set -euo pipefail

echo "==> Installing Podman on RHEL/CentOS/Fedora..."

if command -v dnf &>/dev/null; then
  sudo dnf install -y podman podman-compose
else
  sudo yum install -y podman
fi

echo "==> Podman installed successfully!"
echo "    Version: $(podman --version)"
