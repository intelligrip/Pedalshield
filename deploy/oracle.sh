#!/usr/bin/env bash
#
# oracle.sh — Pedalshield's price + carbon-peg oracle.
#
# Zcash has no on-chain smart contracts, so this is an OFF-CHAIN, SIGNED price
# oracle the treasury host runs. It does three jobs:
#
#   1. PRICE   — fetch ZEC/USD from several independent exchanges and take the
#                MEDIAN, so one bad/stale/hostile source can't move the peg.
#   2. PEG     — convert that price into the reward rate (zat/km) that makes a
#                mile pay exactly the carbon value: 1 lb CO2 avoided/mile ×
#                $0.006/lb = $0.006/mile. (Same target as repeg_carbon_rate.sh,
#                now multi-source + signed.)
#   3. ATTEST  — emit a signed JSON attestation (HMAC-SHA256 over the canonical
#                fields). The backend verifies the signature before trusting a
#                price, and uses the same rate to VALUE inbound miner
#                contributions (how many carbon-miles each donation funds).
#
# Run on the treasury host: print the attestation by default; with --apply it
# also writes the peg into the backend's systemd env and restarts it.
#
# Usage:
#   ./oracle.sh                       # dry run: print signed attestation JSON
#   PEDALSHIELD_ORACLE_SECRET=… ./oracle.sh
#   sudo PEDALSHIELD_ORACLE_SECRET=… ./oracle.sh --apply
#
# Testing the math without network:
#   ORACLE_PRICES="430.10 435.00 428.50" ./oracle.sh
#
set -euo pipefail

# --- The carbon peg (single source of truth; matches repeg_carbon_rate.sh) --
USD_PER_LB_CO2=0.006     # value of 1 lb of CO2 not emitted
LB_CO2_PER_MILE=1.0      # CO2 avoided per mile biked instead of driven
KM_PER_MILE=1.609344
ZAT_PER_ZEC=100000000

SERVICE_FILE=/etc/systemd/system/pedalshield-backend.service
SERVICE_NAME=pedalshield-backend
SECRET="${PEDALSHIELD_ORACLE_SECRET:-}"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# --- Gather ZEC/USD quotes from independent public sources ------------------
# Each parser echoes a bare number or nothing. Missing/garbled sources are
# simply skipped; we median whatever we got (need >= 1, prefer >= 3).
declare -a PRICES=()
declare -a SOURCES=()

add_quote() { # $1=source label  $2=price
  if printf '%s' "${2:-}" | grep -Eq '^[0-9]+(\.[0-9]+)?$'; then
    PRICES+=("$2"); SOURCES+=("$1")
  fi
}

if [ -n "${ORACLE_PRICES:-}" ]; then
  # Test/offline mode: inject a space-separated list of prices.
  i=0
  for p in $ORACLE_PRICES; do add_quote "inject$i" "$p"; i=$((i+1)); done
else
  cg=$(curl -fsS --max-time 12 \
    "https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd" 2>/dev/null \
    | sed -E 's/.*"usd":([0-9.]+).*/\1/' ) || true
  add_quote coingecko "$cg"

  kr=$(curl -fsS --max-time 12 \
    "https://api.kraken.com/0/public/Ticker?pair=ZECUSD" 2>/dev/null \
    | sed -E 's/.*"c":\["([0-9.]+)".*/\1/' ) || true
  add_quote kraken "$kr"

  cb=$(curl -fsS --max-time 12 \
    "https://api.coinbase.com/v2/prices/ZEC-USD/spot" 2>/dev/null \
    | sed -E 's/.*"amount":"([0-9.]+)".*/\1/' ) || true
  add_quote coinbase "$cb"
fi

N=${#PRICES[@]}
if [ "$N" -eq 0 ]; then
  echo "ERROR: no usable ZEC/USD quotes from any source" >&2
  exit 1
fi

# --- Median of the gathered quotes -----------------------------------------
MEDIAN=$(printf '%s\n' "${PRICES[@]}" | sort -n | awk '
  { a[NR]=$1 }
  END {
    if (NR % 2) print a[(NR+1)/2];
    else printf "%.8f\n", (a[NR/2] + a[NR/2+1]) / 2.0;
  }')

# --- Carbon peg: zat/km that makes a mile pay exactly the carbon value ------
ZAT_PER_KM=$(awk -v usd_lb="$USD_PER_LB_CO2" -v lb_mi="$LB_CO2_PER_MILE" \
                 -v km_mi="$KM_PER_MILE" -v zat="$ZAT_PER_ZEC" -v price="$MEDIAN" '
  BEGIN {
    usd_per_mile = usd_lb * lb_mi;
    usd_per_km   = usd_per_mile / km_mi;
    zat_per_km   = (usd_per_km / price) * zat;
    printf "%d\n", (zat_per_km + 0.5);   # round to nearest zatoshi
  }')

TS=$(date -u +%s)
SRC_CSV=$(IFS=,; echo "${SOURCES[*]}")

# --- Canonical payload + HMAC-SHA256 signature ------------------------------
# Canonical form is the exact string the backend re-hashes to verify. Keep the
# field order STABLE; any change is a breaking protocol change.
PAYLOAD="v1|price_usd=${MEDIAN}|zat_per_km=${ZAT_PER_KM}|n=${N}|ts=${TS}"
if [ -n "$SECRET" ]; then
  SIG=$(printf '%s' "$PAYLOAD" \
        | openssl dgst -sha256 -hmac "$SECRET" -hex 2>/dev/null \
        | sed -E 's/.*= *//')
else
  SIG="UNSIGNED"
fi

# --- Emit the signed attestation -------------------------------------------
cat <<JSON
{
  "v": 1,
  "price_usd": ${MEDIAN},
  "sources": "${SRC_CSV}",
  "n": ${N},
  "zat_per_km": ${ZAT_PER_KM},
  "usd_per_mile_target": ${USD_PER_LB_CO2},
  "ts": ${TS},
  "payload": "${PAYLOAD}",
  "sig_hmac_sha256": "${SIG}"
}
JSON

# --- Optionally apply the peg to the live backend --------------------------
if [ "$APPLY" -eq 1 ]; then
  if [ "$SIG" = "UNSIGNED" ]; then
    echo "REFUSING --apply without PEDALSHIELD_ORACLE_SECRET (unsigned)" >&2
    exit 2
  fi
  if [ ! -w "$SERVICE_FILE" ]; then
    echo "ERROR: need write access to $SERVICE_FILE (run with sudo)" >&2
    exit 2
  fi
  if grep -q 'PEDALSHIELD_ZAT_PER_KM=' "$SERVICE_FILE"; then
    sed -i -E "s|PEDALSHIELD_ZAT_PER_KM=[0-9]+|PEDALSHIELD_ZAT_PER_KM=${ZAT_PER_KM}|" "$SERVICE_FILE"
  else
    sed -i -E "/\[Service\]/a Environment=PEDALSHIELD_ZAT_PER_KM=${ZAT_PER_KM}" "$SERVICE_FILE"
  fi
  systemctl daemon-reload
  systemctl restart "$SERVICE_NAME"
  echo "Applied zat_per_km=${ZAT_PER_KM} (median \$${MEDIAN} over ${N} sources) and restarted ${SERVICE_NAME}." >&2
fi
