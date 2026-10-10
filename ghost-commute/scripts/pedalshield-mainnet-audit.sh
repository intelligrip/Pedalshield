#!/usr/bin/env bash
# Pedalshield's real mainnet payouts → a sponsor audit pack + verified statement.
# Run on the Mac (needs Rust + network to zec.rocks). Nothing here spends.
#
#   ./scripts/pedalshield-mainnet-audit.sh own      txids-own.txt   # payouts to YOUR OWN wallet → publishable fixture
#   ./scripts/pedalshield-mainnet-audit.sh all      txids-all.txt   # every payout → private pack + totals-only statement
#
# Getting txid lists (on the droplet; table/column names from backend.rs + fogline.rs):
#   sqlite3 /home/pedal/Pedalshield/zcash-service/pedalshield.sqlite \
#     "SELECT payout_txid FROM claims WHERE status='paid' AND payout_txid IS NOT NULL
#      UNION SELECT payout_txid FROM fogline_claims WHERE status='paid' AND payout_txid IS NOT NULL;" > txids-all.txt
#
# Why two modes: a disclosure names the receiver and lets the holder decrypt that memo
# (Fogline letters carry the rider's next chapter code). Riders' packs stay private.
# Only payouts to your own wallet go in the public repo.
set -euo pipefail
export RUST_BACKTRACE=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PS="$(cd "$ROOT/.." && pwd)"                       # the Pedalshield repo
GHOST="$ROOT/cli/target/release/ghost"
SK="${TREASURY_SK:-$PS/zcash-service/treasury-keys/treasury_spending_key.bin}"
MODE="${1:?own|all}"; TXIDS="${2:?txid list file}"

[ -x "$GHOST" ] || (cd "$ROOT/cli" && cargo build --release)

# Viewing key only; the spending key file is read locally and never copied.
FVK_FILE="$ROOT/treasury.fvk.local"
[ -f "$FVK_FILE" ] || "$GHOST" key fvk-from-sk "$SK" > "$FVK_FILE"
chmod 600 "$FVK_FILE"

case "$MODE" in
  own)
    OUT="$ROOT/fixtures/mainnet"
    mkdir -p "$OUT"
    "$GHOST" audit pack --network main --fvk "@$FVK_FILE" --txids "$TXIDS" \
      --label "Pedalshield mainnet payouts to the founder's own test wallet" --out "$OUT/audit-pack"
    "$GHOST" audit verify "$OUT/audit-pack" --out "$OUT/statement.json"
    cp "$OUT/statement.json" "$ROOT/web/fixtures/statement.json"
    node "$ROOT/scripts/build-single.mjs"
    echo "✓ fixtures/mainnet/ is safe to commit; web/fixtures/statement.json now shows mainnet data."
    echo "  Judges re-verify with: ghost audit verify fixtures/mainnet/audit-pack"
    ;;
  all)
    OUT="$ROOT/private-audit"            # gitignored
    "$GHOST" audit pack --network main --fvk "@$FVK_FILE" --txids "$TXIDS" \
      --label "Pedalshield · all mainnet rider payouts" --out "$OUT/audit-pack"
    "$GHOST" audit verify "$OUT/audit-pack" --out "$OUT/statement.full.json"
    "$GHOST" audit verify "$OUT/audit-pack" --out "$ROOT/fixtures/mainnet/statement.totals.json" --redact-items >/dev/null
    echo "✓ private pack in private-audit/ (do NOT commit). Totals-only statement: fixtures/mainnet/statement.totals.json"
    ;;
  *) echo "mode must be own or all"; exit 1 ;;
esac
