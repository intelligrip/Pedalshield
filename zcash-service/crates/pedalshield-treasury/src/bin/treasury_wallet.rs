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

    /// Sync the WalletDb with the lightwalletd chain tip (v0.5.3b).
    Sync,

    /// Report spendable balance (v0.5.3b).
    Balance,

    /// Construct + broadcast a real Orchard tx (v0.5.3c).
    Send {
        /// Recipient Unified Address.
        #[arg(long)]
        to: String,
        /// Amount in ZEC (e.g. 0.0001).
        #[arg(long)]
        amount_zec: f64,
        /// Print the unsigned tx and stop short of broadcast.
        #[arg(long, default_value_t = false)]
        dry_run: bool,
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
        Cmd::Init => {
            println!("init: NOT YET IMPLEMENTED (v0.5.3a)");
            println!("    will create {} and import the treasury account.", cli.wallet_db.display());
            Ok(())
        }
        Cmd::Sync => {
            println!("sync: NOT YET IMPLEMENTED (v0.5.3b)");
            Ok(())
        }
        Cmd::Balance => {
            println!("balance: NOT YET IMPLEMENTED (v0.5.3b)");
            Ok(())
        }
        Cmd::Send { to, amount_zec, dry_run } => {
            println!("send: NOT YET IMPLEMENTED (v0.5.3c)");
            println!("    would send {} ZEC to {} (dry_run={})", amount_zec, to, dry_run);
            Ok(())
        }
    }
}

fn cmd_info(cli: &Cli) -> Result<(), Box<dyn std::error::Error>> {
    // These imports exist purely to confirm at compile time that the
    // crate features we picked are wired correctly. They're tiny smoke
    // tests of "is the API surface we need actually present".
    use zcash_client_backend::data_api::WalletRead as _;
    use zcash_client_sqlite::WalletDb as _;
    use zcash_protocol::consensus::Network;

    let net = Network::MainNetwork;
    let _ = &net;

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
    println!("  zcash_client_backend: linked (orchard + transparent-inputs)");
    println!("  zcash_client_sqlite:  linked (orchard)");
    println!();
    println!("Next: implement `init` to create WalletDb + import spending key.");
    Ok(())
}
