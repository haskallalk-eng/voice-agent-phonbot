#!/bin/bash
# Phonbot Server First-Time Setup
# Run once on a fresh Ubuntu/Debian VPS
set -e

echo "=== Server Setup ==="

# Docker installieren
apt-get update -y
apt-get install -y ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Docker ohne sudo
usermod -aG docker $USER

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "1. newgrp docker  (apply group without logout)"
echo "2. git clone https://github.com/Hansweier/voice-agent-saas.git /opt/phonbot"
echo "3. cd /opt/phonbot"
echo "4. cp .env.example .env  # then fill in all values"
echo "5. bash scripts/deploy.sh"
