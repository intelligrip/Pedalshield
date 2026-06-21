#!/usr/bin/env bash
#
# repeg_carbon_rate.sh — keep Pedalshield's reward pegged to CARBON VALUE.
#
# The reward is defined as the dollar value of the CO2 a rider keeps out of the
# air by biking instead of driving:
#
#     1 lb CO2 avoided per mile  ×  $0.006 per lb  =  $0.006 per mile
#
# That target is in USD, but the backend pays in ZEC (zatoshi per km), so the
# correct zat/km depends on the live ZEC price. This script fetches the price,
# computes the zat/km that makes a mile pay exactly the carbon value, and (with
# --apply) updates the systemd env + restarts the backend.
#
# Run it on the droplet — manually after a big ZEC move, or from cron (daily).
# Prints the computed value by default; only changes anything with --apply.
# Pure awk math: no `bc` dependency.
#
# Usage:
#   ./repeg_carbon_rate.sh            # dry run: show the computed zat/km
#   sudo ./repeg_carbon_rate.sh --apply
#
set -euo pipefail

# --- The carbon peg (edit here if your inputs change) ---------------------
USD_PER_LB_CO2=0.006     # value of 1 lb of CO2 not emitted
LB_CO2_PER_MILE=1.0      # CO2 avoided per mile biked instead of driven
KM_PER_MILE=1.609344

SERVICE_FILE=/etc/systemd/system/pedalshield-backend.service
SERVICE_NAME=pedalshield-backend

# --- Fetch the current ZEC price (USD) -----------------------------------
# CoinGecko public endpoint; no key needed.
PRICE_JSON=$(curl -fsS "https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd")
ZEC_USD=$(printf '%s' "$PRICE_JSON" | sed -E 's/.*"usd":([0-9.]+).*/\1/')

if [ -z "${ZEC_USD:-}" ] || [ "$ZEC_USD" = "$PRICE_JSON" ]; then
  echo "ERROR: could not parse ZEC price from: $PRICE_JSON" >&2
  exit 1
fi

# --- Compute zat/km so one mile pays exactly the carbon value -------------
# usd_per_mile = USD_PER_LB_CO2 * LB_CO2_PER_MILE
# zat_per_km   = (usd_per_mile / KM_PER_MILE) / ZEC_USD * 1e8
read -r USD_PER_MILE ZAT_PER_KM USD_PER_KM < <(awk -v lb="$USD_PER_LB_CO2" -v n="$LB_CO2_PER_MILE" \
  -v kpm="$KM_PER_MILE" -v price="$ZEC_USD" 'BEGIN {
    upm = lb * n;
    upk = upm / kpm;
    zat = (upk / price) * 100000000;
    printf "%.4f %.0f %.6f", upm, zat, upk;
  }')

echo "Carbon peg:        \$$USD_PER_MILE / mile  ($LB_CO2_PER_MILE lb CO2 x \$$USD_PER_LB_CO2/lb)"
echo "ZEC price (live):  \$$ZEC_USD"
echo "Per-km value:      \$$USD_PER_KM / km"
echo "=> PEDALSHIELD_ZAT_PER_KM = $ZAT_PER_KM"

if [ "${1:-}" != "--apply" ]; then
  echo
  echo "Dry run. Re-run with: sudo $0 --apply"
  exit 0
fi

# --- Apply: rewrite the env line, reload, restart ------------------------
if [ ! -f "$SERVICE_FILE" ]; then
  echo "ERROR: $SERVICE_FILE not found (run on the droplet)." >&2
  exit 1
fi
sed -i -E "s/^Environment=PEDALSHIELD_ZAT_PER_KM=.*/Environment=PEDALSHIELD_ZAT_PER_KM=$ZAT_PER_KM/" "$SERVICE_FILE"
systemctl daemon-reload
systemctl restart "$SERVICE_NAME"
echo "Applied PEDALSHIELD_ZAT_PER_KM=$ZAT_PER_KM and restarted $SERVICE_NAME."
