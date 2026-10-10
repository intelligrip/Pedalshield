#!/usr/bin/env bash
# Ghost Commute on Zcash testnet, using zcash-devtool (ECC's librustzcash CLI)
# as both wallets and testnet.zec.rocks as lightwalletd.
#
#   ./scripts/testnet.sh setup              create sponsor + rider wallets (once)
#   ./scripts/testnet.sh fund               print the sponsor address for a faucet, sync, shield
#   ./scripts/testnet.sh rider-address      fresh diversified Orchard-only address for one payout
#   ./scripts/testnet.sh pay attestation.json   sponsor: check claim, send shielded payout w/ memo
#   ./scripts/testnet.sh disclose <txid>    rider: sync, read memo, write disclosure.json
#   ./scripts/testnet.sh verify [attestation.json]  auditor: verify against lightwalletd
#   ./scripts/testnet.sh public <txid>      what a block explorer can see
#
# The ONLY transparent step anywhere is `fund`: faucets often pay transparent
# addresses, so the sponsor shields those coins into its own shielded pool
# before paying anyone. Rider payouts are always to an Orchard receiver.
set -euo pipefail
export RUST_BACKTRACE=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GHOST="${GHOST:-$ROOT/cli/target/release/ghost}"
DEVTOOL="${DEVTOOL:-zcash-devtool}"
W="${WALLETS:-$ROOT/wallets}"
SERVER="${SERVER:-zecrocks}"             # devtool server alias for testnet.zec.rocks
LWD="${LWD:-https://testnet.zec.rocks:443}"

need() { command -v "$1" >/dev/null || { echo "missing: $1 — $2"; exit 1; }; }
need "$DEVTOOL" "cargo install --git https://github.com/zcash/zcash-devtool --rev 5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8 --locked"
[ -x "$GHOST" ] || (cd "$ROOT/cli" && cargo build --release)

dt() { local who=$1; shift; "$DEVTOOL" wallet -w "$W/$who" "$@"; }
sync_() { dt "$1" sync -s "$SERVER"; }

case "${1:-}" in
  setup)
    mkdir -p "$W"
    for who in sponsor rider; do
      [ -d "$W/$who" ] && { echo "$who wallet exists"; continue; }
      dt "$who" init --name "ghost-$who" -i "$W/$who.identity.txt" -n test -s "$SERVER"
    done
    # The rider's UFVK stays on the rider's machine; `disclose` reads it from here.
    dt rider list-accounts | awk '/UFVK:/{print $2}' > "$W/rider/ufvk.local"
    echo "✓ wallets in $W (gitignored). Rider UFVK saved to $W/rider/ufvk.local"
    ;;
  fund)
    echo "Sponsor address (send testnet TAZ here from a faucet, see zechub.wiki/using-zcash/faucets):"
    dt sponsor list-addresses | grep -m1 -Eo 'utest1[0-9a-z]+'
    read -rp "Press enter once the faucet tx has a confirmation… "
    sync_ sponsor
    dt sponsor balance
    echo "Shielding any transparent funds (setup only; payouts never touch transparent):"
    printf 'y\n' | dt sponsor shield -i "$W/sponsor.identity.txt" -s "$SERVER" || echo "(nothing to shield)"
    ;;
  rider-address)
    UA=$(dt rider gen-addr | grep -m1 -Eo 'utest1[0-9a-z]+')
    "$GHOST" addr orchard-only "$UA"
    ;;
  pay)
    ATT="${2:?usage: pay attestation.json}"
    "$GHOST" claim "$ATT" --zone bend-or --ledger "$W/sponsor/ledger.json" --wallet-dir "$W/sponsor" >/dev/null
    TO=$(node -e 'console.log(require("./payout.json").pay_to)')
    VAL=$(node -e 'console.log(require("./payout.json").value_zat)')
    MEMO=$(node -e 'process.stdout.write(require("./payout.json").memo)')
    sync_ sponsor >/dev/null
    TXID=$(printf 'y\n' | dt sponsor send -i "$W/sponsor.identity.txt" -s "$SERVER" \
           --address "$TO" --value "$VAL" --memo "$MEMO" | tail -1)
    echo "$TXID" > txid.txt
    echo "✓ sent $VAL zat, shielded, memo encrypted. txid $TXID"
    echo "  explorer: https://testnet.zcashexplorer.app/transactions/$TXID"
    ;;
  disclose)
    TXID="${2:-$(cat txid.txt)}"
    sync_ rider >/dev/null
    "$GHOST" disclose create --ufvk "@$W/rider/ufvk.local" --txid "$TXID" --server "$LWD" --show-memo
    ;;
  verify)
    ATT="${2:-attestation.json}"
    "$GHOST" disclose verify disclosure.json --attestation "$ATT" --server "$LWD"
    "$GHOST" disclose verify disclosure.json --attestation "$ATT" --server "$LWD" --json > report.json
    echo "(report.json written for the web Auditor tab)"
    ;;
  public)
    "$GHOST" tx public --txid "${2:-$(cat txid.txt)}" --server "$LWD"
    ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
