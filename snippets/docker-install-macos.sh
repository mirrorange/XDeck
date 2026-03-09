#!/bin/bash
# Install Docker Desktop on macOS (silently)
# Requires: macOS 12+, Apple Silicon or Intel
set -euo pipefail

echo "==> Installing Docker Desktop on macOS..."

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  DMG_URL="https://desktop.docker.com/mac/main/arm64/Docker.dmg"
else
  DMG_URL="https://desktop.docker.com/mac/main/amd64/Docker.dmg"
fi

TMPDIR=$(mktemp -d)
DMG_PATH="$TMPDIR/Docker.dmg"

echo "    Downloading Docker Desktop ($ARCH)..."
curl -fsSL -o "$DMG_PATH" "$DMG_URL"

echo "    Mounting disk image..."
MOUNT_POINT=$(hdiutil attach "$DMG_PATH" -nobrowse -noverify | grep "/Volumes" | awk '{print $NF}')

echo "    Installing Docker.app..."
cp -R "$MOUNT_POINT/Docker.app" /Applications/ 2>/dev/null || \
  sudo cp -R "$MOUNT_POINT/Docker.app" /Applications/

echo "    Cleaning up..."
hdiutil detach "$MOUNT_POINT" -quiet
rm -rf "$TMPDIR"

echo "    Starting Docker Desktop..."
open /Applications/Docker.app

echo "==> Docker Desktop installed successfully!"
echo "    Docker Desktop is starting. Please wait for it to be ready."
