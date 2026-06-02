//! Build script - compiles the vendored lightwalletd .proto into Rust
//! bindings via tonic-build. Output goes to `OUT_DIR` and is included
//! at compile time via `tonic::include_proto!`.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_server(false) // we're a client, not a server
        .compile(&["proto/service.proto"], &["proto"])?;
    println!("cargo:rerun-if-changed=proto/service.proto");
    Ok(())
}
