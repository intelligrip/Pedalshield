# Pedalshield — Private ZEC Marketplace (design)

_A non-custodial, private bicycle marketplace inside Pedalshield, modeled on the
`zkglobalcredit` "Paid Private File" pattern (viewing-key payment detection, per-order
derived addresses, private delivery). Closes the loop: **earn shielded → spend shielded.**_

## The core idea

Riders earn shielded ZEC for riding. The marketplace lets them **spend it privately**
on bike gear, services, and digital goods — paying merchants **directly**, with
Pedalshield never holding a cent. It's the strongest possible Zcash demand engine
(every purchase is another shielded transaction) and it stays true to the mission
(non-custodial, private, no data).

## The payment pattern (borrowed from Paid Private File)

1. **Merchant creates a shop** with a **view-only key (UFVK)** from a *dedicated* ZEC
   account (never their main wallet — a viewing key reveals full history). No email,
   no custody.
2. **Each order gets its own address**, derived from the merchant's viewing key. The
   buyer pays that address.
3. **Pedalshield detects the payment view-only** (it can *see* the incoming shielded
   note, it **cannot spend**) and marks the order paid.
4. **Fulfillment** happens privately (digital goods delivered on-device / over a mixnet
   like Nym; services + vouchers redeemed by code).

Crucially: the **rider pays from their own wallet** (Zodl/Zashi/Zingo) — Pedalshield
generates the payment request (address + amount + memo) and detects settlement. Neither
side hands keys or funds to Pedalshield. Non-custodial on both ends.

## What to sell (and the privacy split)

The model is *perfect* for anything that doesn't need a shipping address, and awkward
for things that do. So lead with the former:

**Private-native (do these first):**
- **Services** — shop tune-ups, fittings, coaching, repair vouchers (redeem by code in-store).
- **Digital goods** — training plans, route packs, maintenance guides, warranties.
- **Redeemable value** — brand discount codes, gift cards, event entries.

**Physical goods (handle carefully — this is where PII leaks in):**
- Parts/gear need a shipping address, which reintroduces the data problem the brand is
  built against. Two privacy-preserving options: (a) **buy a voucher privately, redeem
  in-store / pick-up** (no address); (b) if shipping is unavoidable, collect the address
  **only at the merchant**, encrypted, never stored by Pedalshield, ideally over a private
  channel. Treat physical as Phase 3, not the opener.

## How it plugs into Pedalshield

- **New "Market" tab.** Browse bike shops/brands and listings, priced in ZEC.
- **Pay with earned ZEC.** Tapping "Buy" shows the per-order address + amount (+ memo);
  the rider pays from their connected wallet. Pedalshield watches for the note via the
  merchant's UFVK and flips the order to paid.
- **Reuses what exists.** Your backend already scans the chain and detects shielded notes
  (the spend pipeline + scanner) — payment *detection* is the same machinery pointed at a
  merchant's viewing key instead of the treasury's. Big reuse.
- **Spend your accrued balance.** Optionally let riders apply accrued carbon rewards toward
  a purchase, making the dust rewards feel real (the redemption destination the rewards lacked).

## Phasing (don't boil the ocean)

- **Phase 1 — redemption/affiliate (cheapest, now-ish):** partner discount codes + links;
  riders redeem accrued ZEC value for gear discounts. No in-app payments, no merchant
  onboarding. Proves demand.
- **Phase 2 — the private marketplace (this design):** merchant shops via UFVK,
  per-order addresses, view-only detection, services + digital goods + vouchers.
- **Phase 3 — physical goods** with privacy-preserving fulfillment.

## Honest risks / open questions

- **UFVK export gap (real blocker).** Per the reference site itself: **Zashi/Zodl don't
  export a UFVK yet** — only Zingo!/Zkool do. So merchant onboarding is constrained to those
  wallets until Zodl adds UFVK export. (Another concrete thing to raise with ZODL.)
- **Two-sided cold start.** A marketplace needs *merchants and buyers*. With ~zero users,
  this is two bootstraps at once — which is why Phase 1 (affiliate/redemption, supply-light)
  comes first.
- **Apple's rules.** In-app crypto payments for goods/services sit in a fraught corner of
  App Store policy (IAP, crypto, physical vs digital). This needs careful review before it
  ships in the iOS app — it could threaten your store standing. (Web-based checkout may be
  the safer path initially.)
- **Focus.** This is a Phase-2+ expansion. The core thesis — riders ride, earn, and retain —
  is still unproven. Build the marketplace *after* there's a rider base to sell to, or it's
  a marketplace with no shoppers.

## Why it's worth it (the upside)

Done this way, the marketplace is the rare expansion that is **more** on-mission, not less:
non-custodial, private, no data — and it turns Pedalshield from "earn a little private money"
into a **self-contained private economy**: earn shielded ZEC by riding, spend it privately on
your bike life. That's a flagship demonstration of shielded ZEC as everyday money — exactly
the adoption story Zcash (and ZODL) most want to fund.
