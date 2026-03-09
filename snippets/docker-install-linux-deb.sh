#!/bin/bash
# Install Docker Engine on Ubuntu/Debian
# Source: https://docs.docker.com/engine/install/ubuntu/
set -euo pipefail

echo "==> Installing Docker Engine on Ubuntu/Debian..."

# Remove old versions
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  sudo apt-get remove -y "$pkg" 2>/dev/null || true
done

# Install prerequisites
sudo apt-get update
sudo apt-get install -y ca-certificates curl

# Add Docker GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Detect distro (Ubuntu or Debian)
if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO="$ID"
else
  DISTRO="ubuntu"
fi

if [ "$DISTRO" = "debian" ]; then
  REPO_URL="https://download.docker.com/linux/debian"
else
  REPO_URL="https://download.docker.com/linux/ubuntu"
fi

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] $REPO_URL \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update

# Install Docker
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to docker group
sudo usermod -aG docker "$USER" 2>/dev/null || true

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

echo "==> Docker installed successfully!"
echo "    Version: $(docker --version)"
echo "    Note: Log out and back in for group changes to take effect."
