#!/usr/bin/env bash
# Ghost Commute — full loop with no network. Real crypto (Ed25519 attestation,
# Orchard-protocol note encryption, Halo 2 proof), no chain inclusion.
#
#   ./scripts/demo-offline.sh            run the loop + the "try to cheat" checks
#
# Everything is written to ./demo-out/. Nothing is broadcast.
set -euo pipefail
export RUST_BACKTRACE=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GHOST="${GHOST:-$ROOT/cli/target/release/ghost}"
[ -x "$GHOST" ] || (cd "$ROOT/cli" && cargo build --release)
OUT="$ROOT/demo-out"; rm -rf "$OUT"; mkdir -p "$OUT"; cd "$OUT"

say() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
expect_fail() { if "$@" >err.txt 2>&1; then echo "✗ SHOULD HAVE FAILED: $*"; exit 1; else echo "✓ refused: $(grep -m1 -E '^Error|✗' err.txt | sed 's/^ *//' || tail -1 err.txt)"; fi; }

say "1. Rider wallet (offline throwaway) → fresh Orchard-only address"
UA=$("$GHOST" sim rider)
echo "$UA"

say "2. Rides checked on the device. Only the bike ride gets attested."
for r in car-commute bus-teleport; do
  node "$ROOT/web/attest-cli.mjs" "$ROOT/samples/$r.gpx" --payout-ua "$UA" --out "$r.attestation.json" || true
done
node "$ROOT/web/attest-cli.mjs" "$ROOT/samples/bike-commute.gpx" --payout-ua "$UA" --out attestation.json
echo; echo "What left the phone:"; cat attestation.json

say "3. Sponsor checks the claim and prepares a shielded payout"
"$GHOST" claim attestation.json --zone bend-or --streak 4 --wallet-dir wallets/sponsor

say "4. Sponsor pays (OFFLINE: proven tx, not broadcast)"
TXID=$("$GHOST" sim pay payout.json --out tx.hex)

say "5. What the public chain sees"
"$GHOST" tx public --txid "$TXID" --tx-file tx.hex

say "6. Rider decrypts the memo and makes a one-note disclosure"
"$GHOST" disclose create --ufvk @sim/rider.json --txid "$TXID" --tx-file tx.hex --show-memo

say "7. Auditor verifies the payout. The route is not available to verify, because it was never sent."
"$GHOST" disclose verify disclosure.json --attestation attestation.json --tx-file tx.hex
"$GHOST" disclose verify disclosure.json --attestation attestation.json --tx-file tx.hex --json > report.json

say "8. Try to cheat"
expect_fail "$GHOST" claim attestation.json --zone bend-or                       # replay
python3 - <<'PY'
import json
d=json.load(open("disclosure.json"))
d["value_zat"]+=1;            json.dump(d,open("bad-value.json","w"))
d=json.load(open("disclosure.json"))
d["rseed"]="00"*32;           json.dump(d,open("bad-rseed.json","w"))
d=json.load(open("disclosure.json"))
d["action_index"]=1-d["action_index"]; json.dump(d,open("bad-action.json","w"))
a=json.load(open("attestation.json"))
a["distance_m"]=73000;        json.dump(a,open("inflated.attestation.json","w"))
a=json.load(open("attestation.json"))
a["lat"]=44.06;               json.dump(a,open("leaky.attestation.json","w"))
PY
expect_fail "$GHOST" disclose verify bad-value.json  --tx-file tx.hex             # claim a bigger payout
expect_fail "$GHOST" disclose verify bad-rseed.json  --tx-file tx.hex             # forge the opening
expect_fail "$GHOST" disclose verify bad-action.json --tx-file tx.hex             # point at the dummy action
expect_fail "$GHOST" attest verify inflated.attestation.json                      # edit km after signing
expect_fail "$GHOST" attest verify leaky.attestation.json                         # smuggle a coordinate
node "$ROOT/web/attest-cli.mjs" "$ROOT/samples/walk.gpx" --payout-ua "$UA" --out walk.attestation.json \
  && { echo "✗ walk should be rejected"; exit 1; } || echo "✓ refused: walk is not a bike ride"
cp "$ROOT/samples/bike-commute.gpx" again.gpx
node "$ROOT/web/attest-cli.mjs" again.gpx --payout-ua "$UA" --out again.attestation.json >/dev/null 2>&1
"$GHOST" claim again.attestation.json --zone bend-or >/dev/null 2>&1 \
  && { echo "✗ re-attested ride should be refused"; exit 1; } \
  || echo "✓ refused: same ride re-attested with a fresh salt (overlapping window, same rider key)"

say "9. Sponsor audit pack: disclose EVERY payout with the sponsor's own key (no rider keys)"
mkdir -p txs; cp tx.hex "txs/$TXID.hex"; echo "$TXID" > txids.txt
UA2=$("$GHOST" sim rider --out sim/rider2.json)
for memo in "Letter 2 of 3: the frontier is wherever you haven't been yet." "Thanks for riding. 1.2 mi verified on your phone."; do
  python3 -c 'import json,sys; json.dump({"v":"ghost-commute/payout/1","network":"test","pay_to":sys.argv[1],"value_zat":int(sys.argv[2]),"memo":sys.argv[3]},open("p2.json","w"))' "$UA2" 41000 "$memo"
  T=$("$GHOST" sim pay p2.json --out txs/new.hex 2>/dev/null); mv txs/new.hex "txs/$T.hex"; echo "$T" >> txids.txt
done
"$GHOST" audit pack --fvk "$("$GHOST" sim sponsor-fvk)" --txids txids.txt --tx-dir txs \
  --label "Demo sponsor · pilot payouts (offline)" --out audit-pack
echo; echo "What the auditor receives (one file per payout):"; ls audit-pack
"$GHOST" audit verify audit-pack --tx-dir txs --out statement.json
python3 - <<'PY'
import json,glob
f=sorted(glob.glob("audit-pack/*-ironwood-*.json"))[0]
d=json.load(open(f)); d["value_zat"]*=10; json.dump(d,open(f,"w"),indent=2)
PY
expect_fail "$GHOST" audit verify audit-pack --tx-dir txs --out tampered-statement.json   # inflate one payout in the pack

say "Done. Files in demo-out/. Open web/index.html: Auditor tab → statement.json (or report.json)."
