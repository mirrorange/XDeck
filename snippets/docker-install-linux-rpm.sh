#!/bin/bash
# Install Docker Engine on RHEL/CentOS/Fedora
# Source: https://docs.docker.com/engine/install/centos/
set -euo pipefail

echo "==> Installing Docker Engine on RHEL/CentOS/Fedora..."

# Remove old versions
sudo yum remove -y docker docker-client docker-client-latest docker-common \
  docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null || true

# Install prerequisites
sudo yum install -y yum-utils

# Add Docker repository
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# Install Docker
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to docker group
sudo usermod -aG docker "$USER" 2>/dev/null || true

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

echo "==> Docker installed successfully!"
echo "    Version: $(docker --version)"
echo "    Note: Log out and back in for group changes to take effect."
