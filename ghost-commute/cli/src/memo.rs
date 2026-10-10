//! The 512-byte encrypted memo: a receipt id the sponsor can be audited
//! against, plus one line only the rider (and anyone the rider hands a
//! disclosure to) can read. No coordinates, ever.

use anyhow::{anyhow, ensure, Result};

pub const MEMO_PREFIX: &str = "GHOST1";

const ROASTS: &[&str] = &[
    "Not one photo of your lunch. Proud of you.",
    "Your quads are verified. Your address is none of our business.",
    "Paid in a coin that won't tell your boss where you live.",
    "Strava for people who hate Strava. You hate it beautifully.",
    "A car would have been faster. A car would also have been a snitch.",
    "Snitchless subsidy delivered. The route stayed home, unlike you.",
    "Your streak lives in this memo. This memo lives with you.",
    "Legs: 1. Surveillance capitalism: 0.",
];

pub fn pick_roast(receipt_id: &str, streak: Option<u32>) -> String {
    let n = u8::from_str_radix(&receipt_id[..2], 16).unwrap_or(0) as usize;
    let roast = ROASTS[n % ROASTS.len()];
    match streak {
        Some(s) if s > 1 => format!("Streak {s}. {roast}"),
        _ => roast.to_string(),
    }
}

/// Memo text. Line 1 is machine-readable; line 2 is for the human.
pub fn compose(receipt_id: &str, distance_m: u64, line: &str) -> Result<String> {
    let text = format!(
        "{MEMO_PREFIX} r={receipt_id} d={}.{}km\n{line}",
        distance_m / 1000,
        (distance_m % 1000) / 100
    );
    ensure!(text.len() <= 512, "memo is {} bytes; the limit is 512", text.len());
    ensure!(!text.contains(['@']), "memos must not carry contact details");
    Ok(text)
}

/// ZIP 302 text memo encoding: UTF-8, zero padded to 512 bytes.
pub fn to_bytes(text: &str) -> Result<[u8; 512]> {
    let b = text.as_bytes();
    ensure!(b.len() <= 512, "memo too long");
    ensure!(b.first().map_or(true, |&f| f <= 0xF4), "not a ZIP 302 text memo");
    let mut out = [0u8; 512];
    out[..b.len()].copy_from_slice(b);
    Ok(out)
}

pub fn from_bytes(m: &[u8; 512]) -> Result<String> {
    ensure!(m[0] <= 0xF4, "memo is not a text memo (first byte 0x{:02x})", m[0]);
    let end = m.iter().rposition(|&b| b != 0).map_or(0, |i| i + 1);
    String::from_utf8(m[..end].to_vec()).map_err(|_| anyhow!("memo is not valid UTF-8"))
}

/// Extract the receipt id from line 1, if this is a Ghost Commute memo.
pub fn receipt_of(text: &str) -> Option<String> {
    let first = text.lines().next()?;
    let mut parts = first.split(' ');
    if parts.next()? != MEMO_PREFIX {
        return None;
    }
    parts.find_map(|p| p.strip_prefix("r=")).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        let t = compose("ab".repeat(16).as_str(), 12_400, &pick_roast("ab", Some(3))).unwrap();
        assert!(t.starts_with("GHOST1 r=abab"));
        assert!(t.contains("d=12.4km"));
        let b = to_bytes(&t).unwrap();
        assert_eq!(from_bytes(&b).unwrap(), t);
        assert_eq!(receipt_of(&t).unwrap(), "ab".repeat(16));
    }
}
