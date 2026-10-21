// Links the prebuilt Windows resources (icon and version details) into Everywhere.exe.
// Prebuilt files avoid needing rc.exe/windres on every machine; see assets/everywhere.rc.
fn main() {
    println!("cargo:rerun-if-changed=assets/everywhere.res");
    println!("cargo:rerun-if-changed=assets/everywhere-res.o");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") { return; }
    let dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("assets");
    let file = if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") { "everywhere.res" } else { "everywhere-res.o" };
    println!("cargo:rustc-link-arg-bins={}", dir.join(file).display());
}
