//! treasury_balance - scan recent blocks and report spendable balance.
//!
//! Streams CompactBlocks from a lightwalletd server (zec.rocks by
//! default) and tries to decrypt each Orchard action with the treasury's
//! incoming viewing key. Any decryption that succeeds means *we own*
//! that note - sum the values and report.
//!
//! This is a minimal hand-rolled wallet scanner. It does NOT:
//!   - track nullifiers / detect spends of our own notes
//!   - persist anything to disk
//!   - update an incremental note-commitment tree
//!
//! For v0.5.2b that's enough: confirm the funded 0.01 ZEC arrived. The
//! full WalletDb + commitment-tree wiring lives in v0.5.3 alongside
//! real spend construction.
//!
//! USAGE
//!
//!     cargo run --bin treasury_balance --release
//!     cargo run --bin treasury_balance --release -- --depth 10000
//!
//! Env vars:
//!     PEDALSHIELD_LIGHTWALLETD       gRPC endpoint (default zec.rocks:443)
//!     TREASURY_SPENDING_KEY_FILE     path to spending-key bin (default
//!                                    treasury-keys/treasury_spending_key.bin)

use std::process::ExitCode;
use std::time::{Duration, Instant};

use orchard::keys::{FullViewingKey, IncomingViewingKey, PreparedIncomingViewingKey, Scope, SpendingKey};
use orchard::note_encryption::{CompactAction, OrchardDomain};
use orchard::note::{ExtractedNoteCommitment, Nullifier};
use tokio_stream::StreamExt;
use tonic::transport::{Channel, ClientTlsConfig};
use zcash_note_encryption::{try_compact_note_decryption, EphemeralKeyBytes};

mod proto {
    tonic::include_proto!("cash.z.wallet.sdk.rpc");
}

const DEFAULT_ENDPOINT: &str = "https://zec.rocks:443";
const DEFAULT_DEPTH: u64 = 5_000; // ~4 days of Zcash blocks (75s/block)

struct Args {
    endpoint: String,
    sk_path: String,
    depth: u64,
}

fn parse_args() -> Args {
    let mut depth = DEFAULT_DEPTH;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--depth" => {
                if let Some(v) = it.next() {
                    if let Ok(n) = v.parse() {
                        depth = n;
                    }
                }
            }
            "-h" | "--help" => {
                println!("treasury_balance [--depth N]");
                std::process::exit(0);
            }
            _ => {}
        }
    }
    Args {
        endpoint: std::env::var("PEDALSHIELD_LIGHTWALLETD")
            .unwrap_or_else(|_| DEFAULT_ENDPOINT.into()),
        sk_path: std::env::var("TREASURY_SPENDING_KEY_FILE")
            .unwrap_or_else(|_| "treasury-keys/treasury_spending_key.bin".into()),
        depth,
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> ExitCode {
    let args = parse_args();
    match scan(&args).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            let mut src = e.source();
            let mut depth = 1;
            while let Some(s) = src {
                eprintln!("  caused by [{depth}]: {s}");
                src = s.source();
                depth += 1;
            }
            ExitCode::FAILURE
        }
    }
}

async fn scan(args: &Args) -> Result<(), Box<dyn std::error::Error>> {
    use proto::compact_tx_streamer_client::CompactTxStreamerClient;

    // --- 1. Load spending key, derive incoming viewing key ---
    let sk_bytes = std::fs::read(&args.sk_path)
        .map_err(|e| format!("reading {}: {e}", args.sk_path))?;
    if sk_bytes.len() != 32 {
        return Err(format!(
            "expected 32-byte spending key in {}, got {} bytes",
            args.sk_path,
            sk_bytes.len(),
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

    // --- 2. Connect to lightwalletd ---
    let endpoint = args.endpoint.clone();
    let channel = Channel::from_shared(endpoint.clone())?
        .tls_config(ClientTlsConfig::new())?
        .timeout(Duration::from_secs(60))
        .connect()
        .await?;
    let mut client = CompactTxStreamerClient::new(channel);

    let latest = client
        .get_latest_block(proto::ChainSpec {})
        .await?
        .into_inner();
    let tip_height = latest.height;
    let start_height = tip_height.saturating_sub(args.depth);

    println!(
        "Connected to {endpoint}. Scanning blocks [{start_height} .. {tip_height}] \
         on Orchard for treasury IVK.\n",
    );

    // --- 3. Stream the block range ---
    let range = proto::BlockRange {
        start: Some(proto::BlockId {
            height: start_height,
            hash: vec![],
        }),
        end: Some(proto::BlockId {
            height: tip_height,
            hash: vec![],
        }),
    };
    let mut stream = client.get_block_range(range).await?.into_inner();

    let started = Instant::now();
    let mut blocks_scanned = 0u64;
    let mut actions_inspected = 0u64;
    let mut last_progress_block = start_height;
    let mut found: Vec<(u64, u64, [u8; 32])> = vec![]; // (height, value_zatoshi, nullifier)

    while let Some(block) = stream.next().await {
        let block = block.map_err(|e| format!("stream error: {e}"))?;
        blocks_scanned += 1;

        for tx in &block.vtx {
            for action in &tx.actions {
                actions_inspected += 1;
                if let Some(value) = try_decrypt_action(&prepared_ivk, action) {
                    let mut nf = [0u8; 32];
                    if action.nullifier.len() == 32 {
                        nf.copy_from_slice(&action.nullifier);
                    }
                    found.push((block.height, value, nf));
                    println!(
                        "  + found note at height {} | tx_index {} | value {} zatoshi ({:.8} ZEC)",
                        block.height,
                        tx.index,
                        value,
                        value as f64 / 100_000_000.0,
                    );
                }
            }
        }

        if block.height - last_progress_block >= 500 {
            print!(".");
            use std::io::Write;
            let _ = std::io::stdout().flush();
            last_progress_block = block.height;
        }
    }

    let elapsed = started.elapsed();
    let total_zatoshi: u64 = found.iter().map(|(_, v, _)| v).sum();

    println!();
    println!("\nScan complete in {:.1}s", elapsed.as_secs_f64());
    println!("  blocks scanned:       {}", blocks_scanned);
    println!("  orchard actions:      {}", actions_inspected);
    println!("  notes owned by treasury: {}", found.len());
    println!(
        "  total balance:        {} zatoshi = {:.8} ZEC",
        total_zatoshi,
        total_zatoshi as f64 / 100_000_000.0
    );
    if found.is_empty() {
        println!();
        println!(
            "NOTE: zero notes found. Either (a) the deposit hasn't been mined yet \
             - check the tx on zcashexplorer.app, or (b) the scan depth ({}) doesn't \
             reach back to the deposit block - try `--depth 20000`.",
            args.depth,
        );
    }

    Ok(())
}

/// Try to IVK-decrypt a single CompactOrchardAction. Returns `Some(value_zatoshi)`
/// if the action belongs to our viewing key, `None` otherwise.
fn try_decrypt_action(
    ivk: &PreparedIncomingViewingKey,
    action: &proto::CompactOrchardAction,
) -> Option<u64> {
    if action.cmx.len() != 32
        || action.nullifier.len() != 32
        || action.ephemeral_key.len() != 32
        || action.ciphertext.len() != 52
    {
        return None;
    }

    let cmx = ExtractedNoteCommitment::from_bytes(
        &<[u8; 32]>::try_from(action.cmx.as_slice()).ok()?,
    )
    .into_option()?;
    let nullifier = Nullifier::from_bytes(
        &<[u8; 32]>::try_from(action.nullifier.as_slice()).ok()?,
    )
    .into_option()?;
    let ephemeral_key = EphemeralKeyBytes(
        <[u8; 32]>::try_from(action.ephemeral_key.as_slice()).ok()?,
    );
    let mut enc_ciphertext = [0u8; 52];
    enc_ciphertext.copy_from_slice(&action.ciphertext);

    let compact_action = CompactAction::from_parts(
        nullifier,
        cmx,
        ephemeral_key,
        enc_ciphertext,
    );

    let domain = OrchardDomain::for_compact_action(&compact_action);
    let decrypted = try_compact_note_decryption(&domain, ivk, &compact_action)?;
    let (note, _recipient) = decrypted;
    Some(note.value().inner())
}
