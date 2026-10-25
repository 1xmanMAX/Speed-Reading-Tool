//! Lectura Veloz – native shell.
//!
//! Quick read ("lectura rápida") entry points, all ending in the same
//! `deliver()` call that shows the window and emits to the frontend:
//! * Global shortcut CmdOrCtrl+Alt+R (desktop): reads the clipboard now.
//! * Deep link `lecturaveloz://clipboard` (or `lecturaveloz://read`): waits up
//!   to ~3 s for the clipboard to change (PixPin copies OCR text right before
//!   opening the link), then reads it.
//! * Deep link `lecturaveloz://read?text=...`: reads the given text directly.
//!
//! Events emitted to the frontend:
//! * `"quick-read"`       payload: `String` (the text)
//! * `"quick-read-image"` payload: `String` (`data:image/png;base64,...`, desktop only)
//!
//! Because a cold start via deep link can fire before the page has attached
//! its listeners, the frontend should call the `quick_read_ready` command once
//! after registering listeners; it returns the pending item (if any).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_deep_link::DeepLinkExt;

const SCHEME: &str = "lecturaveloz";
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const POLL_STEPS: u32 = 12; // 12 * 250 ms = 3 s

/// Item returned by `quick_read_ready` for a quick read that arrived before
/// the frontend was listening.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum QuickRead {
    Text { text: String },
    #[allow(dead_code)] // only constructed on desktop
    Image {
        #[serde(rename = "dataUrl")]
        data_url: String,
    },
}

/// Clipboard content as read from the system.
enum Clip {
    Text(String),
    #[cfg(desktop)]
    Image(tauri::image::Image<'static>),
}

/// Cheap identity of a clipboard content, used to detect changes.
#[derive(Clone, PartialEq, Eq)]
enum Fingerprint {
    Text(String),
    #[cfg(desktop)]
    Image(u32, u32, u64),
}

impl Clip {
    fn fingerprint(&self) -> Fingerprint {
        match self {
            Clip::Text(t) => Fingerprint::Text(t.clone()),
            #[cfg(desktop)]
            Clip::Image(img) => {
                use std::hash::{Hash, Hasher};
                let mut h = std::collections::hash_map::DefaultHasher::new();
                img.rgba().hash(&mut h);
                Fingerprint::Image(img.width(), img.height(), h.finish())
            }
        }
    }
}

#[derive(Default)]
struct QuickState {
    /// Fingerprint of the last content delivered to the frontend.
    last: Mutex<Option<Fingerprint>>,
    /// Set once the frontend calls `quick_read_ready`.
    ready: AtomicBool,
    /// Last item delivered before the frontend was ready.
    pending: Mutex<Option<QuickRead>>,
    /// Prevents overlapping clipboard polls from repeated deep links.
    polling: AtomicBool,
}

/// Reads plain text from the clipboard (ignores empty/whitespace-only text).
fn clipboard_text<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.clipboard()
        .read_text()
        .ok()
        .filter(|t| !t.trim().is_empty())
}

/// Reads the clipboard: text first, then (desktop only) an image.
fn read_clip<R: Runtime>(app: &AppHandle<R>) -> Option<Clip> {
    if let Some(text) = clipboard_text(app) {
        return Some(Clip::Text(text));
    }
    #[cfg(desktop)]
    if let Ok(img) = app.clipboard().read_image() {
        if img.width() > 0 && img.height() > 0 {
            return Some(Clip::Image(img.to_owned()));
        }
    }
    None
}

#[cfg(desktop)]
fn png_data_url(img: &tauri::image::Image<'_>) -> Option<String> {
    use base64::Engine as _;
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, img.width(), img.height());
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(img.rgba()).ok()?;
    }
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&buf)
    ))
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(desktop)]
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    #[cfg(mobile)]
    let _ = app;
}

/// Shows the window and sends the content to the frontend.
fn deliver<R: Runtime>(app: &AppHandle<R>, clip: Clip) {
    let state = app.state::<QuickState>();
    *state.last.lock().unwrap() = Some(clip.fingerprint());

    let item = match clip {
        Clip::Text(text) => QuickRead::Text { text },
        #[cfg(desktop)]
        Clip::Image(img) => match png_data_url(&img) {
            Some(data_url) => QuickRead::Image { data_url },
            None => return,
        },
    };

    focus_main(app);
    if !state.ready.load(Ordering::SeqCst) {
        *state.pending.lock().unwrap() = Some(item.clone());
    }
    let _ = match item {
        QuickRead::Text { text } => app.emit("quick-read", text),
        QuickRead::Image { data_url } => app.emit("quick-read-image", data_url),
    };
}

/// Immediate quick read (global shortcut): whatever is in the clipboard now.
#[cfg(desktop)]
fn quick_read_now<R: Runtime>(app: &AppHandle<R>) {
    if let Some(clip) = read_clip(app) {
        deliver(app, clip);
    }
}

/// Deep-link quick read: wait up to 3 s for the clipboard to differ from what
/// we delivered last time (or to be non-empty, the first time); if it never
/// changes, deliver whatever is there at the end (re-reading the same text).
fn quick_read_waiting<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<QuickState>();
    if state.polling.swap(true, Ordering::SeqCst) {
        return; // a poll is already running
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<QuickState>();
        let last = state.last.lock().unwrap().clone();
        let mut delivered = false;
        for step in 0..=POLL_STEPS {
            if let Some(clip) = read_clip(&app) {
                if last.as_ref() != Some(&clip.fingerprint()) {
                    deliver(&app, clip);
                    delivered = true;
                    break;
                }
            }
            if step < POLL_STEPS {
                std::thread::sleep(POLL_INTERVAL);
            }
        }
        if !delivered {
            if let Some(clip) = read_clip(&app) {
                deliver(&app, clip);
            } else {
                focus_main(&app);
            }
        }
        state.polling.store(false, Ordering::SeqCst);
    });
}

fn handle_urls<R: Runtime>(app: &AppHandle<R>, urls: Vec<Url>) {
    for url in urls {
        if url.scheme() != SCHEME {
            continue;
        }
        // `lecturaveloz://read?text=...` → read that text directly.
        if let Some((_, text)) = url.query_pairs().find(|(k, _)| k == "text") {
            if !text.trim().is_empty() {
                deliver(app, Clip::Text(text.into_owned()));
                continue;
            }
        }
        // `lecturaveloz://clipboard`, `lecturaveloz://read`, `lecturaveloz:` …
        match url.host_str().unwrap_or("") {
            "" | "clipboard" | "read" => quick_read_waiting(app),
            _ => focus_main(app),
        }
    }
}

#[tauri::command]
fn read_clipboard(app: AppHandle) -> Option<String> {
    clipboard_text(&app)
}

/// Called by the frontend once its listeners are attached. Returns a quick
/// read that arrived earlier (e.g. app cold-started by a deep link).
#[tauri::command]
fn quick_read_ready(state: tauri::State<'_, QuickState>) -> Option<QuickRead> {
    state.ready.store(true, Ordering::SeqCst);
    state.pending.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin. With the `deep-link` feature, a second launch
    // (e.g. `start lecturaveloz://clipboard`) forwards its URL to this
    // instance, where `on_open_url` below receives it.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main(app);
        }));
    }

    builder = builder
        .manage(QuickState::default())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init());

    builder
        .setup(|app| {
            let handle = app.handle().clone();

            // Installers register the scheme; register at runtime for dev
            // builds (Windows/Linux) and for Linux AppImages.
            #[cfg(any(windows, target_os = "linux"))]
            if cfg!(debug_assertions) || std::env::var_os("APPIMAGE").is_some() {
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("No se pudo registrar el esquema {SCHEME}://: {e}");
                }
            }

            let h = handle.clone();
            app.deep_link().on_open_url(move |event| handle_urls(&h, event.urls()));
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                handle_urls(&handle, urls);
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                // CmdOrCtrl+Alt+R
                #[cfg(target_os = "macos")]
                let primary = Modifiers::SUPER;
                #[cfg(not(target_os = "macos"))]
                let primary = Modifiers::CONTROL;
                let shortcut = Shortcut::new(Some(primary | Modifiers::ALT), Code::KeyR);

                handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, sc, event| {
                            if sc == &shortcut && event.state() == ShortcutState::Pressed {
                                quick_read_now(app);
                            }
                        })
                        .build(),
                )?;

                // Registration fails if another app owns the combo; keep running.
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    eprintln!("No se pudo registrar el atajo global Ctrl+Alt+R: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_clipboard, quick_read_ready])
        .run(tauri::generate_context!())
        .expect("error al iniciar Lectura Veloz");
}
