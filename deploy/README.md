# Pedalshield backend — VPS deploy kit

Gets the autonomous payout backend off the laptop so 100 TestFlight riders can
reach it. Target: any Ubuntu 22/24 VPS (Hetzner CX22 ~€4/mo is fine).
Time: ~30 min + cargo build time.

## Security model (read first)

The server holds the HOT treasury key. Rules:
- Keep ≤2 ZEC on it. Top up weekly from cold storage (the paper seed).
- `PEDALSHIELD_MAX_PAYOUT_ZAT` stays capped (default 500000 = 0.005 ZEC).
- SSH keys only (`PasswordAuthentication no`), ufw allowing 22/80/443 only.

## Steps

1. **DNS:** point `api.<yourdomain>` A-record at the VPS IP.

2. **Server prep (as root):**
   ```bash
   adduser pedal && usermod -aG sudo pedal
   apt update && apt install -y build-essential pkg-config libssl-dev protobuf-compiler git ufw caddy
   ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
   ```
   (Caddy: see https://caddyserver.com/docs/install#debian-ubuntu-raspbian for the apt repo.)

3. **Build on the server** (don't copy the Mac binary — wrong arch/OS):
   ```bash
   su - pedal
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
   source ~/.cargo/env
   git clone https://github.com/intelligrip/Pedalshield.git
   cd Pedalshield/zcash-service && cargo build --release --bin backend
   ```

4. **Ship the key from the Mac** (NOT in git):
   ```bash
   scp $PEDAL/zcash-service/treasury-keys/treasury_spending_key.bin pedal@<vps>:~/Pedalshield/zcash-service/treasury-keys/
   ```
   `chmod 600` it on the server.

5. **Install service + proxy:**
   ```bash
   sudo cp ~/Pedalshield/deploy/pedalshield-backend.service /etc/systemd/system/
   # edit the UA + paths inside if they differ, then:
   sudo systemctl daemon-reload && sudo systemctl enable --now pedalshield-backend
   sudo cp ~/Pedalshield/deploy/Caddyfile /etc/caddy/Caddyfile   # edit domain first
   sudo systemctl reload caddy
   ```

6. **Verify:**
   ```bash
   curl https://api.<yourdomain>/healthz
   journalctl -u pedalshield-backend -f
   ```
   Then submit a test claim from the app pointed at the prod URL and watch a
   real txid come back.

## Updating

```bash
cd ~/Pedalshield && git pull && cd zcash-service && cargo build --release --bin backend && sudo systemctl restart pedalshield-backend
```

## What this kit does NOT do yet

- Accrual/batched settlement (required before 100 concurrent riders; per-ride
  payouts OK for the first ~25)
- Postgres (sqlite is fine at this scale)
- The Ironwood migration (late July — new build, same deploy)
