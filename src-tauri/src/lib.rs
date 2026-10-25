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
//! * `"reader-cmd"`       payload: `String`, one of `toggle`, `faster`,
//!   `slower`, `next`, `prev`, `float`, `voice` (desktop global shortcuts
//!   CmdOrCtrl+Alt+Space/Up/Down/Right/Left/F/V; emitted to window `main`
//!   without focusing it)
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
    Text {
        text: String,
    },
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

/// Window geometry saved before entering mini mode, restored on exit.
#[cfg(desktop)]
#[derive(Clone, Copy)]
struct SavedWindow {
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    maximized: bool,
    fullscreen: bool,
    decorated: bool,
}

/// Saved geometry per window label (desktop only; empty on mobile).
#[derive(Default)]
struct MiniState {
    #[cfg(desktop)]
    saved: Mutex<std::collections::HashMap<String, SavedWindow>>,
}

#[cfg(desktop)]
const MINI_SIZE: (f64, f64) = (460.0, 170.0);
#[cfg(desktop)]
const MINI_MIN_SIZE: (f64, f64) = (260.0, 90.0);
/// Largest mini window (logical px), for both edge dragging and `mini_resize`.
#[cfg(desktop)]
const MINI_MAX_SIZE: (f64, f64) = (1200.0, 500.0);
/// Must match `minWidth`/`minHeight` in tauri.conf.json.
#[cfg(desktop)]
const NORMAL_MIN_SIZE: (f64, f64) = (380.0, 560.0);
#[cfg(desktop)]
const MINI_MARGIN: f64 = 24.0;

/// Floating mini-reader: `enabled = true` turns the window into a small,
/// frameless, always-on-top player at the bottom-right of the current
/// monitor's work area; `false` restores the previous geometry.
/// Returns whether mini mode is now active (always `false` on mobile).
#[tauri::command]
fn set_mini_mode(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MiniState>,
    enabled: bool,
) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri::{LogicalSize, PhysicalPosition, PhysicalSize};
        let e = |err: tauri::Error| err.to_string();
        let label = window.label().to_string();

        if enabled {
            {
                let mut saved = state.saved.lock().unwrap();
                // Already mini: keep the original geometry, just re-place.
                if !saved.contains_key(&label) {
                    saved.insert(
                        label.clone(),
                        SavedWindow {
                            position: window.outer_position().map_err(e)?,
                            size: window.inner_size().map_err(e)?,
                            maximized: window.is_maximized().unwrap_or(false),
                            fullscreen: window.is_fullscreen().unwrap_or(false),
                            decorated: window.is_decorated().unwrap_or(true),
                        },
                    );
                }
            }

            if window.is_fullscreen().unwrap_or(false) {
                window.set_fullscreen(false).map_err(e)?;
            }
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(e)?;
            }
            window.set_decorations(false).map_err(e)?;
            window.set_always_on_top(true).map_err(e)?;
            window.set_resizable(true).map_err(e)?;
            window
                .set_min_size(Some(LogicalSize::new(MINI_MIN_SIZE.0, MINI_MIN_SIZE.1)))
                .map_err(e)?;
            window
                .set_max_size(Some(LogicalSize::new(MINI_MAX_SIZE.0, MINI_MAX_SIZE.1)))
                .map_err(e)?;
            window
                .set_size(LogicalSize::new(MINI_SIZE.0, MINI_SIZE.1))
                .map_err(e)?;
            let _ = window.set_skip_taskbar(false);

            // Bottom-right of the work area (excludes taskbar/dock/menu bar).
            if let Ok(Some(monitor)) = window
                .current_monitor()
                .or_else(|_| window.primary_monitor())
            {
                let sf = monitor.scale_factor();
                let area = monitor.work_area();
                let w = (MINI_SIZE.0 * sf).round() as i32;
                let h = (MINI_SIZE.1 * sf).round() as i32;
                let m = (MINI_MARGIN * sf).round() as i32;
                let x = area.position.x + area.size.width as i32 - w - m;
                let y = area.position.y + area.size.height as i32 - h - m;
                window
                    .set_position(PhysicalPosition::new(
                        x.max(area.position.x),
                        y.max(area.position.y),
                    ))
                    .map_err(e)?;
            }
            let _ = window.set_focus();
            Ok(true)
        } else {
            let saved = state.saved.lock().unwrap().remove(&label);
            window.set_always_on_top(false).map_err(e)?;
            window.set_max_size(None::<LogicalSize<f64>>).map_err(e)?;
            window
                .set_min_size(Some(LogicalSize::new(NORMAL_MIN_SIZE.0, NORMAL_MIN_SIZE.1)))
                .map_err(e)?;
            match saved {
                Some(s) => {
                    window.set_decorations(s.decorated).map_err(e)?;
                    window
                        .set_size(PhysicalSize::new(s.size.width, s.size.height))
                        .map_err(e)?;
                    window.set_position(s.position).map_err(e)?;
                    if s.maximized {
                        window.maximize().map_err(e)?;
                    }
                    if s.fullscreen {
                        window.set_fullscreen(true).map_err(e)?;
                    }
                }
                None => {
                    // Nothing saved (e.g. called twice): fall back to defaults.
                    window.set_decorations(true).map_err(e)?;
                }
            }
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            Ok(false)
        }
    }
    #[cfg(mobile)]
    {
        let _ = (window, state, enabled);
        Ok(false)
    }
}

/// Scales the mini window by `delta` (e.g. `1.1` grows 10 %, `0.9` shrinks),
/// keeping its bottom-right corner fixed and clamping the inner size to
/// `MINI_MIN_SIZE`..=`MINI_MAX_SIZE` (logical px). Used for Ctrl+wheel.
/// No-op (Ok) when the window is not in mini mode, and on mobile.
#[tauri::command]
fn mini_resize(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MiniState>,
    delta: f64,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri::{PhysicalPosition, PhysicalSize};
        let e = |err: tauri::Error| err.to_string();

        if !delta.is_finite() || delta <= 0.0 {
            return Err(format!("delta inválido: {delta}"));
        }
        if !state.saved.lock().unwrap().contains_key(window.label()) {
            return Ok(()); // not in mini mode
        }

        let sf = window.scale_factor().map_err(e)?;
        let inner = window.inner_size().map_err(e)?;
        let outer = window.outer_size().map_err(e)?;
        let pos = window.outer_position().map_err(e)?;

        let w = (inner.width as f64 / sf * delta).clamp(MINI_MIN_SIZE.0, MINI_MAX_SIZE.0);
        let h = (inner.height as f64 / sf * delta).clamp(MINI_MIN_SIZE.1, MINI_MAX_SIZE.1);
        let new_inner = PhysicalSize::new((w * sf).round() as u32, (h * sf).round() as u32);
        if new_inner == inner {
            return Ok(());
        }

        // Frame thickness (0 for an undecorated window, but be safe).
        let frame_w = outer.width.saturating_sub(inner.width) as i32;
        let frame_h = outer.height.saturating_sub(inner.height) as i32;
        let right = pos.x + outer.width as i32;
        let bottom = pos.y + outer.height as i32;

        window.set_size(new_inner).map_err(e)?;
        window
            .set_position(PhysicalPosition::new(
                right - new_inner.width as i32 - frame_w,
                bottom - new_inner.height as i32 - frame_h,
            ))
            .map_err(e)?;
        Ok(())
    }
    #[cfg(mobile)]
    {
        let _ = (window, state, delta);
        Ok(())
    }
}

/// Global shortcuts that control the reader without focusing the window.
/// Each emits `"reader-cmd"` to the main window with the given payload.
#[cfg(desktop)]
const READER_SHORTCUTS: &[(tauri_plugin_global_shortcut::Code, &str, &str)] = {
    use tauri_plugin_global_shortcut::Code;
    &[
        (Code::Space, "toggle", "Space"),
        (Code::ArrowUp, "faster", "Up"),
        (Code::ArrowDown, "slower", "Down"),
        (Code::ArrowRight, "next", "Right"),
        (Code::ArrowLeft, "prev", "Left"),
        (Code::KeyF, "float", "F"),
        (Code::KeyV, "voice", "V"),
    ]
};

/// Sends a reader command to the frontend. Only `"float"` brings a hidden or
/// minimized window back (without stealing focus); the rest leave the window
/// alone so the user can keep working in another app.
#[cfg(desktop)]
fn reader_cmd<R: Runtime>(app: &AppHandle<R>, cmd: &str) {
    if cmd == "float" {
        if let Some(win) = app.get_webview_window("main") {
            if win.is_minimized().unwrap_or(false) {
                let _ = win.unminimize();
            }
            if !win.is_visible().unwrap_or(true) {
                let _ = win.show();
            }
        }
    }
    let _ = app.emit_to("main", "reader-cmd", cmd.to_string());
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
        .manage(MiniState::default())
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
            app.deep_link()
                .on_open_url(move |event| handle_urls(&h, event.urls()));
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                handle_urls(&handle, urls);
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                // CmdOrCtrl+Alt+<key>
                #[cfg(target_os = "macos")]
                let primary = Modifiers::SUPER;
                #[cfg(not(target_os = "macos"))]
                let primary = Modifiers::CONTROL;
                let mods = Some(primary | Modifiers::ALT);
                let shortcut = Shortcut::new(mods, Code::KeyR);
                let reader: Vec<(Shortcut, &'static str, &'static str)> = READER_SHORTCUTS
                    .iter()
                    .map(|&(code, cmd, key)| (Shortcut::new(mods, code), cmd, key))
                    .collect();
                let reader_handler = reader.clone();

                handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, sc, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            if sc == &shortcut {
                                quick_read_now(app);
                            } else if let Some((_, cmd, _)) =
                                reader_handler.iter().find(|(s, _, _)| s == sc)
                            {
                                reader_cmd(app, cmd);
                            }
                        })
                        .build(),
                )?;

                // Registration fails if another app owns the combo; keep running.
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    eprintln!("No se pudo registrar el atajo global Ctrl+Alt+R: {e}");
                }
                for (sc, _, key) in reader {
                    if let Err(e) = app.global_shortcut().register(sc) {
                        eprintln!("No se pudo registrar el atajo global Ctrl+Alt+{key}: {e}");
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_clipboard,
            quick_read_ready,
            set_mini_mode,
            mini_resize
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Lectura Veloz");
}
