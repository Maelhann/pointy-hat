#!/usr/bin/env bash
set -euo pipefail

REPO="Maelhann/pointy-hat"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="pointyhat"

# Detect OS
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      echo "Unsupported OS: $(uname -s)"; exit 1 ;;
esac

# Detect architecture
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)             echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

ASSET="${BINARY_NAME}-${OS}-${ARCH}"
echo "Detected platform: ${OS}/${ARCH}"

# Get latest release tag
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
if [ -z "$LATEST" ]; then
  echo "Failed to determine latest release"
  exit 1
fi
echo "Latest release: ${LATEST}"

# Download binary
URL="https://github.com/${REPO}/releases/download/${LATEST}/${ASSET}"
echo "Downloading ${URL}..."
TMPFILE=$(mktemp)
curl -fsSL -o "$TMPFILE" "$URL"

# Install
chmod +x "$TMPFILE"
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
fi

echo "Installed ${BINARY_NAME} ${LATEST} to ${INSTALL_DIR}/${BINARY_NAME}"
echo "Run 'pointyhat --help' to get started."
