#!/usr/bin/env bash
# Pedalshield backend — one-shot server setup for a fresh Ubuntu 24.04 droplet.
# Run as root:   sudo bash setup.sh
# Does everything EXCEPT copying your treasury key (you scp that from your Mac).
set -euo pipefail

DOMAIN="api.pedalshield.app"
REPO="https://github.com/intelligrip/Pedalshield.git"
PHOME="/home/pedal"
APP="$PHOME/Pedalshield"
KEY="$APP/zcash-service/treasury-keys/treasury_spending_key.bin"

echo "==> 1/6  Creating 'pedal' user"
id pedal &>/dev/null || { adduser --disabled-password --gecos "" pedal; usermod -aG sudo pedal; }

echo "==> 2/6  Installing dependencies + Caddy"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y build-essential pkg-config libssl-dev protobuf-compiler git ufw curl \
                   debian-keyring debian-archive-keyring apt-transport-https gnupg
if ! command -v caddy &>/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> 3/6  Firewall (22/80/443)"
ufw allow 22 >/dev/null; ufw allow 80 >/dev/null; ufw allow 443 >/dev/null; ufw --force enable

echo "==> 4/6  Swap (only if RAM < ~3.5GB and no swap yet)"
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 3500 ] && [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    swap added."
else
  echo "    skipped (enough RAM or swap already present)."
fi

echo "==> 5/6  Cloning + building backend as 'pedal' (this takes several minutes)"
sudo -u pedal bash <<EOF
set -e
if [ ! -d "\$HOME/.cargo" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
source "\$HOME/.cargo/env"
[ -d "$APP" ] || git clone "$REPO" "$APP"
cd "$APP/zcash-service"
cargo build --release --bin backend
EOF

echo "==> 6/6  Installing service + web proxy"
cp "$APP/deploy/pedalshield-backend.service" /etc/systemd/system/
cp "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo ""
echo "============================================================"
if [ -f "$KEY" ]; then
  systemctl enable --now pedalshield-backend
  echo "✅ Backend started. Verify:  curl https://$DOMAIN/healthz"
else
  echo "⚠️  ALMOST DONE — treasury key not found yet."
  echo "   From your Mac, run:"
  echo "   scp ~/Pedalshield/zcash-service/treasury-keys/treasury_spending_key.bin pedal@<THIS_SERVER_IP>:$APP/zcash-service/treasury-keys/"
  echo "   Then back here:  chmod 600 $KEY && sudo systemctl enable --now pedalshield-backend"
  echo "   Finally verify:  curl https://$DOMAIN/healthz"
fi
echo "============================================================"
