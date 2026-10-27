const COMMANDS: &[&str] = &["speak", "stop", "voices", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
