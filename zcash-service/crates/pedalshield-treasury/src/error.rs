use thiserror::Error;

#[derive(Debug, Error)]
pub enum PedalshieldError {
    #[error("anomaly detected: {0}")]
    Anomaly(String),

    #[error("claim already submitted: ride_id={0}")]
    DuplicateClaim(String),

    #[error("invalid claim: {0}")]
    InvalidClaim(String),

    #[error("frost ceremony failed: {0}")]
    FrostError(String),

    #[error("ledger error: {0}")]
    Ledger(String),

    #[error("insufficient treasury balance: requested {requested}, available {available}")]
    InsufficientTreasury { requested: u64, available: u64 },

    #[error("serialisation error: {0}")]
    Serialisation(String),
}

impl From<reddsa::frost::redpallas::Error> for PedalshieldError {
    fn from(e: reddsa::frost::redpallas::Error) -> Self {
        PedalshieldError::FrostError(format!("{e:?}"))
    }
}

impl From<serde_json::Error> for PedalshieldError {
    fn from(e: serde_json::Error) -> Self {
        PedalshieldError::Serialisation(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, PedalshieldError>;
