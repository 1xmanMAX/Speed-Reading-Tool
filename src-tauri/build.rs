fn main() {
    // Google Play exige páginas de 16 KB en las librerías nativas de las apps que apuntan a
    // Android 15+ (los móviles con páginas de 16 KB no cargan un .so alineado a 4 KB).
    // El NDK 27 aún enlaza a 4 KB por defecto; con esto el LOAD queda a 16 KB.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg=-Wl,-z,common-page-size=16384");
    }
    tauri_build::build()
}
