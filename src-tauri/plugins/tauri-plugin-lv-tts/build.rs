const COMMANDS: &[&str] = &["speak", "stop", "voices", "register_listener", "remove_listener", "vibrate", "copy_uri", "notify_pixpin"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
