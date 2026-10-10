//! `ghost` — the Ghost Commute command line.
//!
//!   ghost attest verify   check a rider attestation (signature + schema)
//!   ghost claim           sponsor: turn an attestation into a shielded payout instruction
//!   ghost disclose create rider: build a one-note disclosure from a viewing key + txid
//!   ghost disclose verify auditor: verify a payout without seeing the route
//!   ghost tx public       what the public chain shows for a payout (spoiler: not much)
//!   ghost sim …           offline fallback: real proven tx, no chain

mod attest;
mod audit;
mod canon;
mod disclose;
mod memo;
mod net;
mod sim;

use anyhow::{anyhow, bail, ensure, Context, Result};
use clap::{Args, Parser, Subcommand};
use net::Net;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(name = "ghost", version, about = "Get paid to bike. Nobody learns where you live.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Args, Clone)]
struct Chain {
    /// Network
    #[arg(long, value_enum, default_value = "test", global = true)]
    network: Net,
    /// lightwalletd endpoint (default: zec.rocks for the chosen network)
    #[arg(long)]
    server: Option<String>,
    /// Read the raw transaction (hex) from a file instead of lightwalletd.
    /// Used by the offline sim; chain inclusion is then NOT checked.
    #[arg(long)]
    tx_file: Option<String>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Rider attestations
    Attest {
        #[command(subcommand)]
        cmd: AttestCmd,
    },
    /// Sponsor: check an attestation and emit the payout (address, amount, memo)
    Claim(ClaimArgs),
    /// Address helpers
    Addr {
        #[command(subcommand)]
        cmd: AddrCmd,
    },
    /// One-note payment disclosure
    Disclose {
        #[command(subcommand)]
        cmd: DiscloseCmd,
    },
    /// Transaction views
    Tx {
        #[command(subcommand)]
        cmd: TxCmd,
    },
    /// Offline simulation (real crypto, no chain)
    Sim {
        #[command(subcommand)]
        cmd: SimCmd,
    },
    /// Sponsor audit packs: disclose every payout, verify the lot
    Audit {
        #[command(subcommand)]
        cmd: AuditCmd,
    },
    /// Key helpers (run locally; nothing is sent anywhere)
    Key {
        #[command(subcommand)]
        cmd: KeyCmd,
    },
}

#[derive(Subcommand)]
enum AuditCmd {
    /// Sponsor: recover every payment in the listed txids with your OVK and write one disclosure per payout
    Pack {
        /// Sponsor viewing key: UFVK, raw Orchard FVK hex, or @file
        #[arg(long)]
        fvk: String,
        /// File with one txid per line (# comments allowed)
        #[arg(long)]
        txids: String,
        /// Human label for the statement, e.g. "Pedalshield payouts, Sep 2026"
        #[arg(long, default_value = "sponsor payouts")]
        label: String,
        #[arg(long, default_value = "audit-pack")]
        out: String,
        /// Offline: read <txid>.hex files from this directory instead of lightwalletd
        #[arg(long)]
        tx_dir: Option<String>,
        #[arg(long, value_enum, default_value = "test")]
        network: Net,
        #[arg(long)]
        server: Option<String>,
    },
    /// Auditor: re-verify every disclosure in a pack against the chain
    Verify {
        pack: String,
        #[arg(long)]
        tx_dir: Option<String>,
        #[arg(long)]
        server: Option<String>,
        /// Write the statement JSON here (for the web Auditor tab)
        #[arg(long, default_value = "statement.json")]
        out: String,
        /// Write totals only (no per-payout txids/amounts) — for publishing
        /// aggregate numbers without pointing at individual riders' payouts
        #[arg(long)]
        redact_items: bool,
    },
}

#[derive(Subcommand)]
enum KeyCmd {
    /// Derive the 96-byte Orchard full viewing key (hex) from a 32-byte Orchard
    /// spending key file. The FVK can view, not spend.
    FvkFromSk { sk_file: String },
}

#[derive(Subcommand)]
enum AttestCmd {
    /// Verify signature + schema; print receipt id
    Verify { file: String },
}

#[derive(Args)]
struct ClaimArgs {
    /// attestation.json produced by the rider's phone / web app
    attestation: String,
    #[arg(long, value_enum, default_value = "test")]
    network: Net,
    /// Reward rate in zatoshi per km (1 ZEC = 100,000,000 zat)
    #[arg(long, default_value_t = 10_000)]
    rate_zat_per_km: u64,
    /// Flat bounty in zatoshi instead of per-km
    #[arg(long)]
    flat_zat: Option<u64>,
    /// Per-ride cap in zatoshi
    #[arg(long, default_value_t = 500_000)]
    cap_zat: u64,
    /// Only pay rides whose zone id matches (repeatable)
    #[arg(long)]
    zone: Vec<String>,
    /// Streak count to put in the memo (sponsor's own ledger)
    #[arg(long)]
    streak: Option<u32>,
    /// Override the memo's second line
    #[arg(long)]
    line: Option<String>,
    /// Replay ledger: receipt ids + route commitments already paid
    #[arg(long, default_value = "sponsor-ledger.json")]
    ledger: String,
    /// zcash-devtool wallet dir, used to print the exact send command
    #[arg(long, default_value = "wallets/sponsor")]
    wallet_dir: String,
}

#[derive(Subcommand)]
enum AddrCmd {
    /// Strip a unified address down to its Orchard receiver
    OrchardOnly {
        ua: String,
        #[arg(long, value_enum, default_value = "test")]
        network: Net,
    },
}

#[derive(Subcommand)]
enum DiscloseCmd {
    /// Rider: find the payout note with your UFVK and write a one-note disclosure
    Create {
        /// UFVK string, or @path to a file containing it. Stays on this machine.
        #[arg(long)]
        ufvk: String,
        #[arg(long)]
        txid: String,
        /// Pick a specific action if the tx pays you more than once
        #[arg(long)]
        action: Option<usize>,
        #[arg(long, default_value = "disclosure.json")]
        out: String,
        /// Also print the decrypted memo (rider view)
        #[arg(long)]
        show_memo: bool,
        /// Disclose as the payer: recover your own payment with your OVK
        /// (no rider key needed). Default is as the recipient (IVK).
        #[arg(long)]
        as_sender: bool,
        /// Rider-only receipt (memo + amount) for the web rider view. Never share it.
        #[arg(long, default_value = "rider-receipt.local.json")]
        receipt_out: String,
        #[command(flatten)]
        chain: Chain,
    },
    /// Auditor: verify a disclosure against the chain
    Verify {
        file: String,
        /// Rider attestation to bind the payout to a ride
        #[arg(long)]
        attestation: Option<String>,
        /// Print the rider's memo line
        #[arg(long)]
        show_memo: bool,
        /// Machine-readable output (for the web sponsor view)
        #[arg(long)]
        json: bool,
        #[command(flatten)]
        chain: Chain,
    },
}

#[derive(Subcommand)]
enum TxCmd {
    /// Show everything a block explorer can learn about a payout
    Public {
        #[arg(long)]
        txid: String,
        #[command(flatten)]
        chain: Chain,
    },
}

#[derive(Subcommand)]
enum SimCmd {
    /// Print the offline sim sponsor's viewing key (for `audit pack --tx-dir`)
    SponsorFvk,
    /// Create a throwaway rider wallet (UFVK + fresh Orchard-only address)
    Rider {
        #[arg(long, value_enum, default_value = "test")]
        network: Net,
        #[arg(long)]
        seed_hex: Option<String>,
        #[arg(long, default_value = "sim/rider.json")]
        out: String,
    },
    /// Build a real, proven, NOT-broadcastable payout tx to a claim
    Pay {
        /// payout.json from `ghost claim`
        payout: String,
        #[arg(long, default_value = "sim/tx.hex")]
        out: String,
    },
}

fn read_json(path: &str) -> Result<Value> {
    let s = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
    serde_json::from_str(&s).with_context(|| format!("{path} is not JSON"))
}

fn write_file(path: &str, contents: &str) -> Result<()> {
    if let Some(dir) = std::path::Path::new(path).parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir)?;
        }
    }
    std::fs::write(path, contents).with_context(|| format!("writing {path}"))
}

fn zec(z: u64) -> String {
    format!("{}.{:08}", z / 100_000_000, z % 100_000_000)
}

fn claim(a: ClaimArgs) -> Result<()> {
    let v = read_json(&a.attestation)?;
    let att = attest::verify(&v)?;
    attest::require_bike(&att)?;
    if !a.zone.is_empty() && !a.zone.contains(&att.zone) {
        bail!("ride zone `{}` is not sponsored (allowed: {})", att.zone, a.zone.join(", "));
    }
    let receiver = net::orchard_receiver(&att.payout_ua, a.network)?;
    let pay_to = net::orchard_only_ua(receiver, a.network)?;

    // Replay protection. The ledger stores only receipt ids and salted route
    // commitments: no addresses, no amounts per person, no locations.
    let mut ledger: Value = std::fs::read_to_string(&a.ledger)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({"paid": []}));
    let paid = ledger["paid"].as_array_mut().ok_or_else(|| anyhow!("bad ledger"))?;
    // Same rider key can't be paid twice for overlapping 15-minute slots. Slots
    // are stored hashed with the rider key, so the ledger alone is not a timeline.
    let slots: Vec<String> = (att.window_start..att.window_end)
        .step_by(attest::WINDOW_QUANTUM_S as usize)
        .map(|t| {
            use sha2::{Digest, Sha256};
            hex::encode(&Sha256::digest(format!("{}:{t}", hex::encode(att.rider_pk)).as_bytes())[..16])
        })
        .collect();
    for p in paid.iter() {
        ensure!(p["receipt_id"] != att.receipt_id, "this attestation was already paid");
        ensure!(p["route_commit"] != att.route_commit, "this exact ride was already paid (same route commitment)");
        if let Some(ps) = p["slots"].as_array() {
            ensure!(
                !ps.iter().any(|x| slots.iter().any(|s| x == s)),
                "this rider was already paid for a ride overlapping this time window"
            );
        }
    }

    let amount = match a.flat_zat {
        Some(f) => f,
        None => att.distance_m * a.rate_zat_per_km / 1000,
    }
    .min(a.cap_zat);
    ensure!(amount > 0, "ride too short to pay");

    let line = a.line.unwrap_or_else(|| memo::pick_roast(&att.receipt_id, a.streak));
    let memo_text = memo::compose(&att.receipt_id, att.distance_m, &line)?;

    paid.push(json!({"receipt_id": att.receipt_id, "route_commit": att.route_commit, "slots": slots}));
    write_file(&a.ledger, &serde_json::to_string_pretty(&ledger)?)?;

    let out = json!({
        "v": "ghost-commute/payout/1",
        "network": a.network.name(),
        "pay_to": pay_to,
        "value_zat": amount,
        "memo": memo_text,
        "receipt_id": att.receipt_id,
    });
    let out_path = "payout.json";
    write_file(out_path, &serde_json::to_string_pretty(&out)?)?;

    eprintln!("✓ rider signature verifies, motion verdict `bike` ({}), zone `{}`", att.check, att.zone);
    eprintln!("✓ {}.{} km → {} ZEC (cap {} ZEC)", att.distance_m / 1000, (att.distance_m % 1000) / 100, zec(amount), zec(a.cap_zat));
    eprintln!("✓ paying the Orchard receiver only (transparent/Sapling receivers stripped)");
    eprintln!("✓ wrote {out_path}; receipt {} added to {}", att.receipt_id, a.ledger);
    eprintln!();
    eprintln!("Send it (shielded, memo encrypted to the rider):");
    eprintln!();
    println!(
        "zcash-devtool wallet -w {} send -i {}.identity.txt --address {} --value {} --memo {}",
        a.wallet_dir,
        a.wallet_dir,
        pay_to,
        amount,
        shell_quote(&memo_text)
    );
    Ok(())
}

fn shell_quote(s: &str) -> String {
    format!("$'{}'", s.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n"))
}

fn ufvk_arg(s: &str) -> Result<String> {
    match s.strip_prefix('@') {
        Some(p) => {
            let t = std::fs::read_to_string(p).with_context(|| format!("reading {p}"))?;
            // Accept a bare key or a JSON file with a "ufvk" / "fvk" field (sim/*.json).
            if let Ok(v) = serde_json::from_str::<Value>(&t) {
                for k in ["ufvk", "fvk"] {
                    if let Some(u) = v.get(k).and_then(Value::as_str) {
                        return Ok(u.to_string());
                    }
                }
            }
            Ok(t.trim().to_string())
        }
        None => Ok(s.to_string()),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // tonic's TLS needs one rustls crypto provider; pick ring explicitly.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Attest { cmd: AttestCmd::Verify { file } } => {
            let a = attest::verify(&read_json(&file)?)?;
            println!("✓ valid attestation");
            println!("  receipt id   {}", a.receipt_id);
            println!("  rider key    {}", hex::encode(a.rider_pk));
            println!("  distance     {} m", a.distance_m);
            println!("  window       {} – {}", a.window_start, a.window_end);
            println!("  zone         {}", a.zone);
            println!("  motion       {} ({})", a.verdict, a.check);
            println!("  coordinates  none (schema has nowhere to put them)");
        }
        Cmd::Claim(a) => claim(a)?,
        Cmd::Addr { cmd: AddrCmd::OrchardOnly { ua, network } } => {
            println!("{}", net::orchard_only_ua(net::orchard_receiver(&ua, network)?, network)?);
        }
        Cmd::Disclose { cmd } => match cmd {
            DiscloseCmd::Create { ufvk, txid, action, out, show_memo, as_sender, receipt_out, chain } => {
                let id = net::parse_txid(&txid)?;
                let (tx, height, source) =
                    net::load_tx(&id, chain.tx_file.as_deref(), chain.server.as_deref(), chain.network).await?;
                let role = if as_sender { disclose::Role::Sender } else { disclose::Role::Recipient };
                let fvk = disclose::parse_fvk(&ufvk_arg(&ufvk)?, chain.network)?;
                let found = disclose::find_notes(&tx, &fvk, role);
                ensure!(!found.is_empty(), "no note in this transaction is visible to this viewing key as {}", role.name());
                let pick = match action {
                    Some(i) => found.iter().find(|f| f.action_index == i).ok_or_else(|| anyhow!("no note of yours at action {i}"))?,
                    None => {
                        let ghosts: Vec<_> = found
                            .iter()
                            .filter(|f| f.memo_text.as_deref().and_then(memo::receipt_of).is_some())
                            .collect();
                        match ghosts.len() {
                            1 => ghosts[0],
                            0 if found.len() == 1 => &found[0],
                            0 => bail!("several notes in this tx and none carries a Ghost Commute receipt; pass --action"),
                            _ => bail!("several Ghost Commute notes in this tx; pass --action"),
                        }
                    }
                };
                let d = disclose::make_disclosure(pick, &tx.txid().to_string(), chain.network, height)?;
                write_file(&out, &serde_json::to_string_pretty(&d)?)?;
                write_file(&receipt_out, &serde_json::to_string_pretty(&json!({
                    "v": "ghost-commute/rider-receipt/1",
                    "txid": tx.txid().to_string(),
                    "pool": pick.pool.name(),
                    "value_zat": pick.note.value().inner(),
                    "memo": pick.memo_text,
                }))?)?;
                eprintln!("source: {source}");
                if as_sender {
                    eprintln!("(as sender: recovered with your outgoing viewing key)");
                }
                eprintln!("✓ found the note: {} ZEC in the {} pool, action #{}", zec(pick.note.value().inner()), pick.pool.name(), pick.action_index);
                if show_memo {
                    eprintln!();
                    eprintln!("── your memo (the chain sees ciphertext) ──");
                    eprintln!("{}", pick.memo_text.as_deref().unwrap_or("(binary memo)"));
                    eprintln!("───────────────────────────────────────────");
                    eprintln!();
                }
                eprintln!("✓ wrote {out}: opens exactly this one note. Your viewing key did not leave this machine.");
            }
            DiscloseCmd::Verify { file, attestation, show_memo, json: as_json, chain } => {
                let d = read_json(&file)?;
                let id = net::parse_txid(d["txid"].as_str().ok_or_else(|| anyhow!("disclosure has no txid"))?)?;
                let (tx, height, source) =
                    net::load_tx(&id, chain.tx_file.as_deref(), chain.server.as_deref(), chain.network).await?;
                let att = attestation.as_deref().map(read_json).transpose()?;
                let r = disclose::verify(&d, &tx, height, source, att.as_ref(), chain.network)?;
                if as_json {
                    println!("{}", serde_json::to_string_pretty(&disclose::report_json(&r, show_memo))?);
                } else {
                    disclose::print_report(&r, show_memo);
                }
                if !r.ok() {
                    std::process::exit(1);
                }
            }
        },
        Cmd::Tx { cmd: TxCmd::Public { txid, chain } } => {
            let id = net::parse_txid(&txid)?;
            let (tx, height, source) =
                net::load_tx(&id, chain.tx_file.as_deref(), chain.server.as_deref(), chain.network).await?;
            println!("What anyone with a block explorer sees ({source}):");
            println!("  txid            {}", tx.txid());
            println!("  version         {:?}, branch {:?}", tx.version(), tx.consensus_branch_id());
            println!("  mined height    {}", height.map_or("unknown".into(), |h| h.to_string()));
            println!("  transparent     {}", if tx.transparent_bundle().is_some() { "present" } else { "none" });
            for (name, b) in [("orchard", tx.orchard_bundle()), ("ironwood", tx.ironwood_bundle())] {
                if let Some(b) = b {
                    println!("  {name:<15} {} actions, net value balance {} zat (fee/pool movement only)", b.actions().len(), i64::from(*b.value_balance()));
                    for (i, a) in b.actions().iter().enumerate() {
                        println!("    #{i}  cmx {}…  ciphertext {} bytes (amount, recipient, memo: encrypted)", &hex::encode(a.cmx().to_bytes())[..16], a.encrypted_note().enc_ciphertext.len());
                    }
                }
            }
            println!("  sender          not shown (shielded)");
            println!("  recipient       not shown (shielded)");
            println!("  amount          not shown (shielded)");
            println!("  memo            not shown (encrypted to the recipient)");
            println!("  route           was never here");
        }
        Cmd::Sim { cmd } => match cmd {
            SimCmd::Rider { network, seed_hex, out } => {
                let seed = seed_hex
                    .map(|s| -> Result<[u8; 32]> {
                        hex::decode(s)?.try_into().map_err(|_| anyhow!("seed must be 32 bytes"))
                    })
                    .transpose()?;
                let r = sim::rider(seed, network)?;
                write_file(&out, &serde_json::to_string_pretty(&r)?)?;
                eprintln!("✓ wrote {out} (OFFLINE demo wallet)");
                println!("{}", r["payout_ua"].as_str().unwrap());
            }
            SimCmd::SponsorFvk => println!("{}", sim::sponsor_fvk_hex()?),
            SimCmd::Pay { payout, out } => {
                let p = read_json(&payout)?;
                let n = Net::from_name(p["network"].as_str().unwrap_or("test"))?;
                let (txid, raw) = sim::pay(
                    n,
                    p["pay_to"].as_str().ok_or_else(|| anyhow!("payout.pay_to missing"))?,
                    p["value_zat"].as_u64().ok_or_else(|| anyhow!("payout.value_zat missing"))?,
                    p["memo"].as_str().ok_or_else(|| anyhow!("payout.memo missing"))?,
                )?;
                write_file(&out, &hex::encode(raw))?;
                eprintln!("✓ OFFLINE tx {txid} written to {out} ({} pool, proven, NOT broadcastable)", "ironwood");
                println!("{txid}");
            }
        },
        Cmd::Audit { cmd } => match cmd {
            AuditCmd::Pack { fvk, txids, label, out, tx_dir, network, server } => {
                let fvk = disclose::parse_fvk(&ufvk_arg(&fvk)?, network)?;
                let ids = audit::read_txids(&txids)?;
                eprintln!("Building audit pack for {} txids ({}):", ids.len(), network.name());
                let m = audit::pack(&fvk, &ids, tx_dir.as_deref(), server.as_deref(), network, &label, &out).await?;
                let n = m["disclosures"].as_array().map_or(0, Vec::len);
                ensure!(n > 0, "no payouts recovered; is this the sender's viewing key?");
                eprintln!("✓ {n} disclosures + pack.json in {out}/ — hand the folder to the auditor");
            }
            AuditCmd::Verify { pack, tx_dir, server, out, redact_items } => {
                let mut s = audit::verify(&pack, tx_dir.as_deref(), server.as_deref()).await?;
                if redact_items {
                    s["items"] = json!([]);
                    s["redacted"] = json!("per-payout rows removed; totals verified by the issuer");
                }
                write_file(&out, &serde_json::to_string_pretty(&s)?)?;
                audit::print_statement(&s);
                eprintln!("(statement written to {out} for the web Auditor tab)");
                if s["all_verified"] != true {
                    std::process::exit(1);
                }
            }
        },
        Cmd::Key { cmd: KeyCmd::FvkFromSk { sk_file } } => {
            let b = std::fs::read(&sk_file).with_context(|| format!("reading {sk_file}"))?;
            let arr: [u8; 32] = match b.len() {
                32 => b.try_into().unwrap(),
                _ => hex::decode(String::from_utf8_lossy(&b).trim())
                    .ok()
                    .and_then(|v| v.try_into().ok())
                    .ok_or_else(|| anyhow!("expected a 32-byte binary or 64-hex-char Orchard spending key"))?,
            };
            let sk: orchard::keys::SpendingKey = Option::from(orchard::keys::SpendingKey::from_bytes(arr))
                .ok_or_else(|| anyhow!("invalid Orchard spending key"))?;
            println!("{}", hex::encode(orchard::keys::FullViewingKey::from(&sk).to_bytes()));
            eprintln!("(Orchard FVK: can view this wallet's notes and outgoing payments; cannot spend. Treat as confidential.)");
        }
    }
    Ok(())
}
