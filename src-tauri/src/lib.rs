mod formats;
mod fsx;
mod markdown;
mod settings;
mod translate;
mod watch;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub translations: translate::TranslationRuns,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// Queue of file paths from CLI args or macOS Open events.
///
/// Deliberately a process-global, NOT Tauri-managed state: macOS delivers
/// `application:openURLs:` during launch, before `setup` has run
/// `app.manage(AppState)`. Touching managed state there panics
/// ("state() called before manage()"), and a panic cannot unwind through
/// tao's `extern "C"` AppKit callback, aborting the app (SIGABRT).
static PENDING_OPEN: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn pending_open() -> std::sync::MutexGuard<'static, Vec<String>> {
    PENDING_OPEN.lock().unwrap_or_else(|e| e.into_inner())
}

/// Frontend pulls queued file paths (from CLI args or macOS Open events) once ready.
#[tauri::command]
fn take_pending_open() -> Vec<String> {
    std::mem::take(&mut *pending_open())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let db = translate::init_db(app.handle()).map_err(|e| e.to_string())?;
            for arg in std::env::args().skip(1) {
                if !arg.starts_with('-') && std::path::Path::new(&arg).exists() {
                    let p = std::fs::canonicalize(&arg)
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or(arg);
                    pending_open().push(p);
                }
            }
            app.manage(AppState {
                db: Mutex::new(db),
                translations: translate::TranslationRuns::default(),
                watcher: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_open,
            formats::get_format_catalog,
            fsx::detect_file,
            fsx::read_text_file,
            fsx::list_dir,
            markdown::render_markdown,
            settings::get_settings,
            settings::save_settings,
            settings::test_llm_connection,
            settings::open_settings_window,
            translate::translate_doc,
            translate::cancel_translate,
            translate::translation_cache_stats,
            translate::clear_translation_cache,
            watch::watch_file,
            watch::unwatch_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        let _ = &app_handle;
        match event {
            // macOS "Open With" / drag onto Dock icon.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                use tauri::Emitter;
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if paths.is_empty() {
                    return;
                }
                pending_open().extend(paths);
                let _ = app_handle.emit("open-file", ());
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            }
            _ => {}
        }
    });
}
