//! Voz nativa para Android: el WebView de Android no implementa `speechSynthesis`,
//! así que los comandos `plugin:lv-tts|speak|stop|voices` se reenvían al plugin Kotlin.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("lv-tts")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("com.lecturaveloz.tts", "TtsPlugin")?;
            Ok(())
        })
        .build()
}
