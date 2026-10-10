//! Network selection, addresses, and fetching transactions from lightwalletd.

use anyhow::{anyhow, bail, Context, Result};
use zcash_address::unified::{self, Container, Encoding};
use zcash_client_backend::proto::service::{
    compact_tx_streamer_client::CompactTxStreamerClient, TxFilter,
};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::{BlockHeight, BranchId, Network, NetworkType};
use zcash_protocol::TxId;

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Net {
    Test,
    Main,
}

impl Net {
    pub fn params(self) -> Network {
        match self {
            Net::Test => Network::TestNetwork,
            Net::Main => Network::MainNetwork,
        }
    }
    pub fn net_type(self) -> NetworkType {
        match self {
            Net::Test => NetworkType::Test,
            Net::Main => NetworkType::Main,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Net::Test => "test",
            Net::Main => "main",
        }
    }
    pub fn from_name(s: &str) -> Result<Self> {
        match s {
            "test" => Ok(Net::Test),
            "main" => Ok(Net::Main),
            _ => bail!("unknown network `{s}`"),
        }
    }
    pub fn default_server(self) -> &'static str {
        match self {
            Net::Test => "https://testnet.zec.rocks:443",
            Net::Main => "https://zec.rocks:443",
        }
    }
}

/// Pull the Orchard-protocol receiver out of a Unified Address.
/// Errors if the UA has none: Ghost Commute never pays a transparent or Sapling receiver.
pub fn orchard_receiver(ua: &str, net: Net) -> Result<[u8; 43]> {
    let (nt, addr) = unified::Address::decode(ua)
        .map_err(|e| anyhow!("not a unified address ({e}); Ghost Commute pays Orchard receivers only"))?;
    if nt != net.net_type() {
        bail!("address is for {:?}, expected {:?}", nt, net.net_type());
    }
    addr.items()
        .into_iter()
        .find_map(|r| match r {
            unified::Receiver::Orchard(b) => Some(b),
            _ => None,
        })
        .ok_or_else(|| anyhow!("address has no Orchard receiver; refusing to pay it"))
}

/// Re-encode as a UA carrying only the Orchard receiver. This is what the
/// sponsor actually pays, so no wallet can "helpfully" fall back to a
/// transparent receiver.
pub fn orchard_only_ua(receiver: [u8; 43], net: Net) -> Result<String> {
    let ua = unified::Address::try_from_items(vec![unified::Receiver::Orchard(receiver)])
        .map_err(|e| anyhow!("{e}"))?;
    Ok(ua.encode(&net.net_type()))
}

pub fn parse_txid(s: &str) -> Result<TxId> {
    TxId::from_hex(s.trim()).ok_or_else(|| anyhow!("txid must be 64 hex characters"))
}

/// A raw transaction plus the height lightwalletd says it was mined at.
pub struct FetchedTx {
    pub raw: Vec<u8>,
    pub height: Option<u32>,
}

pub async fn fetch_tx(server: &str, txid: &TxId) -> Result<FetchedTx> {
    use tonic::transport::{Channel, ClientTlsConfig};
    let uri: tonic::transport::Uri = server.parse().context("bad server URI")?;
    let mut channel = Channel::from_shared(server.to_string())?;
    if uri.scheme_str() == Some("https") {
        let host = uri.host().ok_or_else(|| anyhow!("server URI has no host"))?;
        let mut tls = ClientTlsConfig::new()
            .domain_name(host.to_string())
            .assume_http2(true)
            .with_webpki_roots();
        // Optional extra CA (corporate TLS proxies, self-hosted lightwalletd).
        if let Ok(path) = std::env::var("GHOST_CA_FILE") {
            let pem = std::fs::read(&path).with_context(|| format!("reading GHOST_CA_FILE {path}"))?;
            tls = tls.ca_certificate(tonic::transport::Certificate::from_pem(pem));
        }
        channel = channel.tls_config(tls)?;
    }
    let mut client = CompactTxStreamerClient::new(
        channel
            .connect()
            .await
            .with_context(|| format!("could not reach lightwalletd at {server}"))?,
    );
    let resp = client
        .get_transaction(TxFilter {
            hash: txid.as_ref().to_vec(),
            ..Default::default()
        })
        .await
        .map_err(|s| anyhow!("lightwalletd GetTransaction failed: {}", s.message()))?
        .into_inner();
    // lightwalletd encodes "not mined" as u64::MAX (-1); anything that doesn't
    // fit in u32 is treated as unmined.
    let height = u32::try_from(resp.height).ok().filter(|h| *h > 0);
    Ok(FetchedTx { raw: resp.data, height })
}

pub fn parse_tx(raw: &[u8], height: Option<u32>, net: Net) -> Result<Transaction> {
    // v5/v6 transactions carry their consensus branch id in the header; the
    // hint below only matters for older formats.
    let branch = match height {
        Some(h) => BranchId::for_height(&net.params(), BlockHeight::from_u32(h)),
        None => BranchId::Nu6_3,
    };
    Transaction::read(raw, branch).context("could not parse transaction")
}

/// Load a transaction either from a hex file (offline / `ghost sim`) or from lightwalletd.
pub async fn load_tx(
    txid: &TxId,
    tx_file: Option<&str>,
    server: Option<&str>,
    net: Net,
) -> Result<(Transaction, Option<u32>, String)> {
    let (fetched, source) = match tx_file {
        Some(path) => {
            let hexs = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
            (
                FetchedTx { raw: hex::decode(hexs.trim()).context("tx file is not hex")?, height: None },
                format!("file {path} (offline: chain inclusion NOT checked)"),
            )
        }
        None => {
            let s = server.unwrap_or(net.default_server());
            (fetch_tx(s, txid).await?, format!("lightwalletd {s}"))
        }
    };
    let tx = parse_tx(&fetched.raw, fetched.height, net)?;
    if tx.txid() != *txid {
        bail!("transaction data hashes to {}, not {}", tx.txid(), txid);
    }
    Ok((tx, fetched.height, source))
}
