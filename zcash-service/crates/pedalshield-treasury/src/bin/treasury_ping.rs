//! treasury_ping - validate lightwalletd gRPC connectivity to Zcash mainnet.
//!
//! Connects to mainnet.lightwalletd.com:9067 over TLS, calls
//! `GetLightdInfo` and `GetLatestBlock`, prints the result. This is the
//! cheapest possible test that our gRPC + TLS plumbing reaches a real
//! mainnet lightwalletd server.
//!
//! USAGE
//!
//!     cargo run --bin treasury_ping --release
//!     PEDALSHIELD_LIGHTWALLETD=https://other.host:9067 \
//!         cargo run --bin treasury_ping --release
//!
//! If this works, the next step (v0.5.2b) is wallet sync: scan blocks
//! from the treasury's birthday height, decrypt with the viewing key,
//! report the balance. That confirms the funded 0.01 ZEC actually
//! arrived at the treasury UA on chain.

use std::process::ExitCode;
use tonic::transport::{Channel, ClientTlsConfig};

mod proto {
    tonic::include_proto!("cash.z.wallet.sdk.rpc");
}

// zec.rocks is the community-run lightwalletd that Zashi uses by
// default. It's TLS on the standard HTTPS port (443), so firewalls
// rarely block it. The old ECC-operated mainnet.lightwalletd.com:9067
// endpoint is unreliable / sometimes offline; we keep it commented as
// a fallback.
const DEFAULT_ENDPOINT: &str = "https://zec.rocks:443";

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let endpoint = std::env::var("PEDALSHIELD_LIGHTWALLETD")
        .unwrap_or_else(|_| DEFAULT_ENDPOINT.into());
    match ping(&endpoint).await {
        Ok(report) => {
            println!("{report}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("error connecting to {endpoint}: {e}");
            // Walk the error source chain - tonic's outer "transport error"
            // usually hides a much more useful inner error (TLS handshake
            // failure, DNS, connection refused, etc.).
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

async fn ping(endpoint: &str) -> Result<String, Box<dyn std::error::Error>> {
    use proto::compact_tx_streamer_client::CompactTxStreamerClient;

    // Build the TLS-enabled channel. ClientTlsConfig::new() uses the
    // system root store (enabled by tonic's "tls-roots" feature).
    let endpoint_owned = endpoint.to_string();
    let channel = Channel::from_shared(endpoint_owned)?
        .tls_config(ClientTlsConfig::new())?
        .connect()
        .await?;

    let mut client = CompactTxStreamerClient::new(channel);

    let info = client
        .get_lightd_info(proto::Empty {})
        .await?
        .into_inner();
    let latest = client
        .get_latest_block(proto::ChainSpec {})
        .await?
        .into_inner();

    Ok(format!(
        "Lightwalletd ({endpoint})\n  vendor:                {vendor}\n  version:               {version}\n  chain_name:            {chain}\n  reported_height:       {bh}\n  estimated_tip:         {eh}\n  sapling_activation:    {sap}\n\nGetLatestBlock\n  height: {lh}\n  hash:   {hash}\n",
        vendor = info.vendor,
        version = info.version,
        chain = info.chain_name,
        bh = info.block_height,
        eh = info.estimated_height,
        sap = info.sapling_activation_height,
        lh = latest.height,
        hash = hex::encode(latest.hash),
    ))
}
