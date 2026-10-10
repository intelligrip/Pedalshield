//! Canonical JSON: sorted keys, no whitespace, integers only.
//!
//! The browser (web/ghost-core.js `canonical()`) and this module must produce
//! byte-identical output, because the rider's Ed25519 signature and the receipt
//! id are computed over it. Floats are rejected on purpose: they are where
//! JS and Rust serializers quietly disagree.

use anyhow::{bail, Result};
use serde_json::Value;

pub fn canonical(v: &Value) -> Result<String> {
    let mut out = String::new();
    write(v, &mut out)?;
    Ok(out)
}

fn write(v: &Value, out: &mut String) -> Result<()> {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else {
                bail!("canonical JSON forbids non-integer numbers (got {n})");
            }
        }
        Value::String(s) => {
            // serde_json's string escaping matches JSON.stringify for the
            // characters we allow (we additionally restrict to printable ASCII).
            if !s.chars().all(|c| (' '..='~').contains(&c)) {
                bail!("canonical JSON strings must be printable ASCII");
            }
            out.push_str(&serde_json::to_string(s)?);
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(x, out)?;
            }
            out.push(']');
        }
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k)?);
                out.push(':');
                write(&m[*k], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sorted_and_compact() {
        let v: Value = serde_json::from_str(r#"{"b":1,"a":{"d":"x","c":[1,2]}}"#).unwrap();
        assert_eq!(canonical(&v).unwrap(), r#"{"a":{"c":[1,2],"d":"x"},"b":1}"#);
    }
    #[test]
    fn rejects_floats() {
        let v: Value = serde_json::from_str(r#"{"a":1.5}"#).unwrap();
        assert!(canonical(&v).is_err());
    }
}
