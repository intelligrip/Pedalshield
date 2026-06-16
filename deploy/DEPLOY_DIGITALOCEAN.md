# Deploy the Pedalshield backend on DigitalOcean — quickstart

_End result: your autonomous payout backend runs 24/7 at **https://api.pedalshield.app**, so the iOS app can submit rides and pay riders. ~30 min + build time. Companion to `deploy/README.md` (this is the DO-specific version; the Caddyfile + systemd service are already set to `api.pedalshield.app`)._

> ⚠️ This server holds the **hot treasury key**. Keep ≤ 2 ZEC on it, top up weekly from cold storage, SSH-keys only. Don't put the key in git.

---

## 1. Create the droplet
DigitalOcean → **Create → Droplets**:
- **Image:** Ubuntu **24.04 (LTS)**
- **Size:** Basic → **Regular** → **4 GB / 2 vCPU ($24/mo)** recommended (builds the Rust stack cleanly). The 2 GB/$12 works too — add swap in step 4.
- **Authentication:** **SSH Key** (most secure). If you don't have one, on your Mac:
  ```bash
  ssh-keygen -t ed25519 -C "intelligrip"      # press Enter through the prompts
  cat ~/.ssh/id_ed25519.pub                    # copy this, paste into DigitalOcean
  ```
- Create it, then copy the droplet's **public IP** (e.g. 203.0.113.x).

## 2. Point DNS at the droplet
In **Netlify** (where pedalshield.app lives) → Domains → DNS → add a record:
- **Type:** A · **Name:** `api` · **Value:** your droplet IP · TTL default

(That makes `api.pedalshield.app` → your droplet. The apex `pedalshield.app` stays on Netlify untouched.) DNS can take a few minutes to propagate.

## 3. Connect to the droplet
From your Mac Terminal:
```bash
ssh root@YOUR_DROPLET_IP
```
(Type `yes` to trust it the first time.)

## 4. Server prep (run as root)
```bash
adduser pedal && usermod -aG sudo pedal
apt update && apt install -y build-essential pkg-config libssl-dev protobuf-compiler git ufw
# Caddy (web server + auto-HTTPS):
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
# Firewall:
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```
**If you chose the 2 GB droplet, add swap so the build doesn't get killed:**
```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 5. Build the backend (as the `pedal` user)
```bash
su - pedal
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
git clone https://github.com/intelligrip/Pedalshield.git
cd Pedalshield/zcash-service && cargo build --release --bin backend
```
(The build takes several minutes — that's normal.)

## 6. Send the treasury key from your Mac (NOT in git)
Open a **new** Terminal tab on your Mac:
```bash
scp ~/Pedalshield/zcash-service/treasury-keys/treasury_spending_key.bin \
    pedal@YOUR_DROPLET_IP:~/Pedalshield/zcash-service/treasury-keys/
```
Back on the server, lock it down:
```bash
chmod 600 ~/Pedalshield/zcash-service/treasury-keys/treasury_spending_key.bin
```

## 7. Start the service + web proxy (as `pedal`, with sudo)
```bash
sudo cp ~/Pedalshield/deploy/pedalshield-backend.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pedalshield-backend
sudo cp ~/Pedalshield/deploy/Caddyfile /etc/caddy/Caddyfile     # already set to api.pedalshield.app
sudo systemctl reload caddy
```

## 8. Verify it's live
```bash
curl https://api.pedalshield.app/healthz          # should return OK
journalctl -u pedalshield-backend -f               # live logs (Ctrl-C to exit)
```
If `/healthz` answers over HTTPS, the backend is live and the app's production build (already pointed at `https://api.pedalshield.app`) will work.

## 9. Then ship the app
```bash
cd ~/Pedalshield/mobile
npm install -g eas-cli && eas login
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

---

## Keep it safe (ongoing)
- **≤ 2 ZEC** on the hot key; top up weekly from the cold/paper seed.
- Payout cap stays at `PEDALSHIELD_MAX_PAYOUT_ZAT=500000` (0.005 ZEC).
- Update later with: `cd ~/Pedalshield && git pull && cd zcash-service && cargo build --release --bin backend && sudo systemctl restart pedalshield-backend`
- Scale note (from the kit): per-ride payouts are fine for the first ~25 riders; add accrual/batched settlement before ~100 concurrent.
