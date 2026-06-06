//! treasury_wallet - real wallet CLI built on zcash_client_backend.
//!
//! This is the staging ground for v0.5.3 spend construction. The
//! subcommands are scaffolded but only `--help` and `info` actually
//! work in the first cut - we're using this binary to verify the
//! dep graph compiles cleanly with the chosen feature set before we
//! layer the wallet machinery on top.
//!
//! Planned subcommands:
//!   init     create sqlite WalletDb and import the treasury spending key
//!   sync     fetch new blocks from lightwalletd and update WalletDb
//!   balance  report spendable balance from WalletDb
//!   send     construct + sign + broadcast a real Orchard payout tx
//!   info     print loaded paths, endpoints, versions
//!
//! USAGE
//!
//!     cargo run --bin treasury_wallet --release -- info
//!     cargo run --bin treasury_wallet --release -- sync
//!     cargo run --bin treasury_wallet --release -- send \
//!         --to u1xxx... --amount-zec 0.0001

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "treasury_wallet",
    version,
    about = "Pedalshield treasury wallet (Orchard spends via zcash_client_backend)"
)]
struct Cli {
    /// Path to the sqlite WalletDb file.
    #[arg(long, default_value = "treasury-keys/wallet.sqlite", global = true)]
    wallet_db: PathBuf,

    /// Lightwalletd gRPC endpoint.
    #[arg(long, default_value = "https://zec.rocks:443", global = true)]
    endpoint: String,

    /// Path to the treasury spending key file (raw 32 bytes).
    #[arg(
        long,
        default_value = "treasury-keys/treasury_spending_key.bin",
        global = true
    )]
    spending_key_file: PathBuf,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Print loaded paths + dep versions; verify the build is wired.
    Info,

    /// Create the WalletDb and import the treasury account (v0.5.3a).
    Init,

    /// Sync the Orchard commitment tree from lightwalletd and report
    /// treasury-owned notes with their marked tree positions (v0.5.3b).
    Sync {
        /// Start block height (default: tip - depth).
        #[arg(long)]
        from: Option<u64>,
        /// End block height (default: chain tip).
        #[arg(long)]
        to: Option<u64>,
        /// Blocks back from tip when --from is omitted.
        #[arg(long, default_value_t = 5000)]
        depth: u64,
        /// Seed the tree from the on-chain Orchard frontier at (from-1)
        /// via GetTreeState, so positions + witness anchor match consensus.
        #[arg(long, default_value_t = false)]
        seed: bool,
    },

    /// Report spendable balance (v0.5.3b).
    Balance,

    /// Construct + broadcast a real Orchard tx (v0.5.3c).
    Send {
        /// Recipient Unified Address.
        #[arg(long)]
        to: String,
        /// Amount in ZEC (e.g. 0.0001). Currently informational; a spend
        /// consumes the whole note and pays (note - fee).
        #[arg(long, default_value_t = 0.0)]
        amount_zec: f64,
        /// Build + prove only; do not broadcast (Milestone A).
        #[arg(long, default_value_t = false)]
        dry_run: bool,
        /// Block height where the note was received (scan range start).
        #[arg(long, default_value_t = 3361149)]
        from_block: u64,
        /// Anchor height / scan range end. 0 = chain tip (use this for a
        /// real broadcast so the anchor is recent enough for consensus).
        #[arg(long, default_value_t = 0)]
        to_block: u64,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match cli.cmd {
        Cmd::Info => cmd_info(&cli),
        Cmd::Init => cmd_init(&cli),
        Cmd::Sync { from, to, depth, seed } => cmd_sync(&cli, from, to, depth, seed),
        Cmd::Balance => {
            println!("balance: NOT YET IMPLEMENTED (v0.5.3b)");
            Ok(())
        }
        Cmd::Send { ref to, amount_zec, dry_run, from_block, to_block } => {
            cmd_send(&cli, to.clone(), amount_zec, dry_run, from_block, to_block)
        }
    }
}

fn cmd_init(_cli: &Cli) -> Result<(), Box<dyn std::error::Error>> {
    println!("init: deferred to v1.1");
    println!();
    println!("zcash_client_sqlite 0.20.2 + zcash_client_backend 0.22 declare");
    println!("they want each other but don't compile together cleanly as of");
    println!("the hackathon window. The autonomous spend path is parked");
    println!("until the librustzcash ecosystem ships a stable pair.");
    println!();
    println!("For v0.5.3 we use the manual-operator payout flow:");
    println!("  1. Phone POSTs claims to the backend");
    println!("  2. Operator gets a queue of pending claims");
    println!("  3. Operator sends each payout from Zashi");
    println!("  4. Operator marks claim paid with the real tx hash");
    Ok(())
}

fn cmd_info(cli: &Cli) -> Result<(), Box<dyn std::error::Error>> {
    println!("treasury_wallet v{}", env!("CARGO_PKG_VERSION"));
    println!();
    println!("Paths");
    println!("  wallet_db:           {}", cli.wallet_db.display());
    println!("  spending_key_file:   {}", cli.spending_key_file.display());
    println!("  wallet_db exists:    {}", cli.wallet_db.exists());
    println!("  spending key exists: {}", cli.spending_key_file.exists());
    println!();
    println!("Network");
    println!("  endpoint:            {}", cli.endpoint);
    println!("  network:             mainnet");
    println!();
    println!("Build");
    println!("  mode: v0.5.3 manual-operator (wallet crates parked for v1.1)");
    println!();
    println!("Operator workflow:");
    println!("  1. Phone POSTs claims to the backend (port 8787)");
    println!("  2. Run `treasury_wallet pending` to see queued claims");
    println!("  3. Send payout from Zashi to the recipient UA");
    println!("  4. Run `treasury_wallet mark-paid <claim_id> <tx_hash>`");
    Ok(())
}


fn cmd_sync(
    cli: &Cli,
    from: Option<u64>,
    to: Option<u64>,
    depth: u64,
    seed: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()?;
    rt.block_on(sync_async(cli, from, to, depth, seed))
}

async fn sync_async(
    cli: &Cli,
    from: Option<u64>,
    to: Option<u64>,
    depth: u64,
    seed: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    use orchard::keys::{
        FullViewingKey, IncomingViewingKey, PreparedIncomingViewingKey, Scope, SpendingKey,
    };
    use pedalshield_treasury::proto;
    use pedalshield_treasury::proto::compact_tx_streamer_client::CompactTxStreamerClient;
    use pedalshield_treasury::spend::scanner::{process_block, FoundNote, ScanProgress};
    use pedalshield_treasury::spend::tree::OrchardTree;
    use std::time::{Duration, Instant};
    use tokio_stream::StreamExt;
    use tonic::transport::{Channel, ClientTlsConfig};

    let sk_bytes = std::fs::read(&cli.spending_key_file)
        .map_err(|e| format!("reading {}: {e}", cli.spending_key_file.display()))?;
    if sk_bytes.len() != 32 {
        return Err(format!(
            "expected 32-byte spending key in {}, got {} bytes",
            cli.spending_key_file.display(),
            sk_bytes.len()
        )
        .into());
    }
    let mut sk_arr = [0u8; 32];
    sk_arr.copy_from_slice(&sk_bytes);
    let sk = SpendingKey::from_bytes(sk_arr)
        .into_option()
        .ok_or("spending key bytes failed validation")?;
    let fvk = FullViewingKey::from(&sk);
    let ivk: IncomingViewingKey = fvk.to_ivk(Scope::External);
    let prepared_ivk = PreparedIncomingViewingKey::new(&ivk);

    let channel = Channel::from_shared(cli.endpoint.clone())?
        .tls_config(ClientTlsConfig::new())?
        .timeout(Duration::from_secs(60))
        .connect()
        .await?;
    let mut client = CompactTxStreamerClient::new(channel);

    let tip = client
        .get_latest_block(proto::ChainSpec {})
        .await?
        .into_inner()
        .height;

    let (start, end) = match (from, to) {
        (Some(f), Some(t)) => (f, t),
        (Some(f), None) => (f, tip),
        (None, Some(t)) => (t.saturating_sub(depth), t),
        (None, None) => (tip.saturating_sub(depth), tip),
    };
    if start > end {
        return Err(format!("empty range: start {start} > end {end}").into());
    }

    println!(
        "Syncing Orchard tree over blocks [{start} .. {end}] (tip {tip}) from {}\n",
        cli.endpoint
    );

    let mut tree = if seed {
        let seed_height = start.saturating_sub(1);
        let ts = client
            .get_tree_state(proto::BlockId { height: seed_height, hash: vec![] })
            .await?
            .into_inner();
        println!(
            "Seeding frontier via GetTreeState @ block {} (network {}, orchardTree {} hex chars)",
            ts.height,
            ts.network,
            ts.orchard_tree.len()
        );
        OrchardTree::from_tree_state(&ts.orchard_tree)?
    } else {
        OrchardTree::empty()
    };
    println!("  seeded leaves (global position offset): {}\n", tree.position());

    let range = proto::BlockRange {
        start: Some(proto::BlockId { height: start, hash: vec![] }),
        end: Some(proto::BlockId { height: end, hash: vec![] }),
    };
    let mut stream = client.get_block_range(range).await?.into_inner();

    let mut found: Vec<FoundNote> = Vec::new();
    let mut progress = ScanProgress::default();
    let started = Instant::now();
    let mut last_dot = start;

    while let Some(block) = stream.next().await {
        let block = block.map_err(|e| format!("stream error: {e}"))?;
        let h = block.height;
        process_block(&block, &prepared_ivk, &mut tree, &mut found, &mut progress)?;
        if h.saturating_sub(last_dot) >= 500 {
            print!(".");
            use std::io::Write;
            let _ = std::io::stdout().flush();
            last_dot = h;
        }
    }

    println!();
    println!("\nSync complete in {:.1}s", started.elapsed().as_secs_f64());
    println!("  blocks scanned:    {}", progress.blocks_scanned);
    println!("  actions inspected: {}", progress.actions_inspected);
    println!("  tree leaves:       {}", tree.position());
    println!("  notes found:       {}", found.len());
    let anchor_hex: String = tree
        .root()
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    println!("  anchor (tree root): {anchor_hex}");

    // Spend-validity proof: our hand-rolled root must equal the actual
    // on-chain Orchard root at `end`. If these match, the witness anchor
    // is a real consensus anchor and the spend will verify.
    if seed {
        let ts_end = client
            .get_tree_state(proto::BlockId { height: end, hash: vec![] })
            .await?
            .into_inner();
        let expected = OrchardTree::from_tree_state(&ts_end.orchard_tree)?;
        let expected_hex: String = expected
            .root()
            .to_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if expected_hex == anchor_hex {
            println!("  ANCHOR VERIFIED: our root == GetTreeState({end}) root (spend-valid)");
        } else {
            println!("  ANCHOR MISMATCH: on-chain root @ {end} = {expected_hex}");
        }
    }

    for n in &found {
        println!(
            "  + note: position {} | value {} zat ({:.8} ZEC) | block {} | tx_index {}",
            n.position,
            n.value_zatoshi,
            n.value_zatoshi as f64 / 100_000_000.0,
            n.block_height,
            n.tx_index
        );
        match tree.witness(n.position) {
            Ok(w) => println!(
                "      witness OK | auth_path depth {} | position {}",
                w.auth_path.len(),
                w.position
            ),
            Err(e) => println!("      WITNESS MISSING for position {}: {e}", n.position),
        }
    }

    if found.is_empty() {
        println!("\nNo treasury notes in range. Widen with --from/--to or --depth.");
    }

    Ok(())
}

fn cmd_send(
    cli: &Cli,
    to: String,
    amount_zec: f64,
    dry_run: bool,
    from_block: u64,
    to_block: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()?;
    rt.block_on(send_async(cli, to, amount_zec, dry_run, from_block, to_block))
}

async fn send_async(
    cli: &Cli,
    to: String,
    amount_zec: f64,
    dry_run: bool,
    from_block: u64,
    _to_block: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    use orchard::keys::SpendingKey;
    use pedalshield_treasury::spend::spender::pay;

    let sk_bytes = std::fs::read(&cli.spending_key_file)
        .map_err(|e| format!("reading {}: {e}", cli.spending_key_file.display()))?;
    if sk_bytes.len() != 32 {
        return Err(format!("expected 32-byte spending key, got {}", sk_bytes.len()).into());
    }
    let mut a = [0u8; 32];
    a.copy_from_slice(&sk_bytes);
    let sk = SpendingKey::from_bytes(a)
        .into_option()
        .ok_or("spending key bytes failed validation")?;

    let amount_zat = (amount_zec * 1e8).round() as u64;
    let mode = if dry_run {
        "DRY-RUN (build + prove + sign, no broadcast)"
    } else {
        "BROADCAST"
    };
    let amt_label = if amount_zat == 0 {
        "entire note minus fee".to_string()
    } else {
        format!("{amount_zat} zat ({amount_zec:.8} ZEC)")
    };
    println!("Orchard spend -> {to}");
    println!("  mode: {mode}");
    println!("  amount: {amt_label}");
    println!("  scanning from birthday {from_block} to tip, selecting an unspent note, proving...\n");

    let r = pay(&cli.endpoint, &sk, &to, amount_zat, from_block, !dry_run).await?;

    println!("SIGNED v5 TRANSACTION BUILT");
    println!(
        "  note value:      {} zat ({:.8} ZEC)",
        r.note_value_zat,
        r.note_value_zat as f64 / 1e8
    );
    println!(
        "  recipient value: {} zat ({:.8} ZEC)",
        r.recipient_value_zat,
        r.recipient_value_zat as f64 / 1e8
    );
    println!(
        "  change value:    {} zat ({:.8} ZEC)",
        r.change_value_zat,
        r.change_value_zat as f64 / 1e8
    );
    println!("  fee (zip317):    {} zat", r.fee_zat);
    println!("  note position:   {}", r.position);
    println!("  anchor:          {}", r.anchor_hex);
    println!("  target height:   {}", r.target_height);
    println!("  tx size:         {} bytes", r.tx_size);
    println!("  txid:            {}", r.txid_hex);

    match r.broadcast {
        None => {
            println!("\nDry-run only - not broadcast. Re-run without --dry-run to send it.");
        }
        Some((0, _)) => {
            println!("\nBROADCAST ACCEPTED by lightwalletd. Track txid {} on a block explorer.", r.txid_hex);
        }
        Some((code, msg)) => {
            return Err(format!("broadcast REJECTED (code {code}): {msg}").into());
        }
    }
    Ok(())
}
