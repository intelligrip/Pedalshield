//! treasury_keygen - generate a new Pedalshield treasury wallet.
//!
//! Produces an Orchard spending key + a Zcash Unified Address (mainnet
//! by default; pass `--testnet` for testnet). Writes three files into
//! the directory you pass via `--out-dir` (default: `./treasury-keys`):
//!
//!   - `treasury_seed.txt`     24-word BIP-39 mnemonic. KEEP OFFLINE.
//!   - `treasury_spending_key.bin` raw 32-byte Orchard spending key.
//!   - `treasury_address.txt`  the fundable mainnet UA (public).
//!
//! On Unix, the two private files are written with mode 0600.
//!
//! USAGE
//!
//!     cargo run --bin treasury_keygen --release
//!     cargo run --bin treasury_keygen --release -- --testnet
//!     cargo run --bin treasury_keygen --release -- --out-dir /secure/path
//!
//! AFTER GENERATION
//!
//!   1. Back up `treasury_seed.txt` to paper. Lose it = lose the
//!      treasury forever. No recovery.
//!   2. Move `treasury_spending_key.bin` somewhere only the backend
//!      can read (a Fly.io secret, an env var, or a vault).
//!   3. Send ZEC to the UA in `treasury_address.txt` from your wallet.
//!   4. Confirm receipt with `cargo run --bin treasury_balance` (a
//!      separate binary we'll add once the backend skeleton is up).

use bip39::{Language, Mnemonic, Seed};
use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use rand::rngs::OsRng;
use rand::RngCore;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use zcash_address::unified::{Address as UnifiedAddress, Encoding, Receiver};
use zcash_protocol::consensus::NetworkType;

#[derive(Debug)]
struct Args {
    out_dir: PathBuf,
    testnet: bool,
    force: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut out_dir = PathBuf::from("treasury-keys");
    let mut testnet = false;
    let mut force = false;
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--out-dir" => {
                out_dir = PathBuf::from(
                    it.next().ok_or("--out-dir requires a path")?,
                );
            }
            "--testnet" => testnet = true,
            "--force" => force = true,
            "-h" | "--help" => {
                print_usage();
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Args { out_dir, testnet, force })
}

fn print_usage() {
    println!("treasury_keygen - generate a Pedalshield treasury wallet");
    println!();
    println!("USAGE:");
    println!("    treasury_keygen [--out-dir DIR] [--testnet] [--force]");
    println!();
    println!("FLAGS:");
    println!("    --out-dir DIR  Write key files here (default: ./treasury-keys)");
    println!("    --testnet      Generate a testnet UA instead of mainnet");
    println!("    --force        Overwrite existing files in the out-dir");
    println!("    -h, --help     Print this message");
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e}");
            print_usage();
            return ExitCode::from(2);
        }
    };

    match generate(&args) {
        Ok(report) => {
            println!();
            println!("{report}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn generate(args: &Args) -> Result<String, String> {
    let network = if args.testnet {
        NetworkType::Test
    } else {
        NetworkType::Main
    };

    // --- 1. Refuse to clobber an existing treasury unless --force ---
    fs::create_dir_all(&args.out_dir)
        .map_err(|e| format!("cannot create out-dir: {e}"))?;
    let seed_path = args.out_dir.join("treasury_seed.txt");
    let sk_path = args.out_dir.join("treasury_spending_key.bin");
    let addr_path = args.out_dir.join("treasury_address.txt");
    if !args.force {
        for p in [&seed_path, &sk_path, &addr_path] {
            if p.exists() {
                return Err(format!(
                    "{} exists; pass --force to overwrite (you almost \
                     certainly do NOT want to do this if it holds funds)",
                    p.display(),
                ));
            }
        }
    }

    // --- 2. Generate a 24-word BIP-39 mnemonic (256 bits of entropy) ---
    let mut entropy = [0u8; 32];
    OsRng.fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy(&entropy, Language::English)
        .map_err(|e| format!("mnemonic generation failed: {e}"))?;
    let seed = Seed::new(&mnemonic, "");
    let seed_bytes = seed.as_bytes();

    // --- 3. Derive Orchard spending key via ZIP-32 ---
    // Zcash mainnet coin_type = 133, testnet = 1. Account 0 = the first
    // hardened account. AccountId rejects values >= 2^31 because hardened
    // derivation uses the top bit; try_from is the documented constructor.
    let coin_type: u32 = if args.testnet { 1 } else { 133 };
    let account_id = zip32::AccountId::try_from(0u32)
        .map_err(|e| format!("invalid account id: {e:?}"))?;
    let sk = SpendingKey::from_zip32_seed(seed_bytes, coin_type, account_id)
        .map_err(|e| format!("ZIP-32 derivation failed: {e:?}"))?;
    let fvk = FullViewingKey::from(&sk);
    let orchard_addr = fvk.address_at(0u32, Scope::External);

    // --- 4. Wrap the Orchard address in a Unified Address ---
    let receivers = vec![Receiver::Orchard(orchard_addr.to_raw_address_bytes())];
    let ua = UnifiedAddress::try_from_items(receivers)
        .map_err(|e| format!("UA construction failed: {e:?}"))?;
    let ua_string = ua.encode(&network);

    // --- 5. Persist three files ---
    write_secret(&seed_path, mnemonic.phrase().as_bytes())?;
    write_secret(&sk_path, sk.to_bytes())?;
    fs::write(&addr_path, format!("{}\n", ua_string))
        .map_err(|e| format!("writing address file: {e}"))?;

    // --- 6. Report ---
    let net_label = if args.testnet { "TESTNET" } else { "MAINNET" };
    Ok(format!(
        "Treasury generated ({net_label}).\n\
         \n\
         UNIFIED ADDRESS (fund this from your wallet):\n  {ua_string}\n\
         \n\
         Files written to: {out}\n  - treasury_seed.txt         (24-word mnemonic, BACK UP OFFLINE)\n  - treasury_spending_key.bin (raw 32 bytes, KEEP SECRET)\n  - treasury_address.txt      (the UA above)\n\
         \n\
         NEXT STEPS:\n  1. Write down the 24 words on paper. Store offline.\n  2. Send a small test amount of ZEC (0.001) to the UA above.\n  3. Once confirmed, send the rest of your treasury budget.\n  4. Once the backend is up, set TREASURY_SPENDING_KEY_FILE={sk}\n",
        out = args.out_dir.display(),
        sk = sk_path.display(),
    ))
}

/// Write a file containing sensitive material. On Unix, chmod 0600.
fn write_secret(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::fs::OpenOptions;
    let mut opts = OpenOptions::new();
    opts.write(true).create(true).truncate(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }

    let mut f = opts
        .open(path)
        .map_err(|e| format!("opening {}: {e}", path.display()))?;
    f.write_all(bytes)
        .map_err(|e| format!("writing {}: {e}", path.display()))?;
    Ok(())
}
