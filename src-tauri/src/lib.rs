mod fsx;
mod markdown;
mod settings;
mod translate;
mod watch;

use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub epoch: AtomicU64,
    pub pending_open: Mutex<Vec<String>>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// Frontend pulls queued file paths (from CLI args or macOS Open events) once ready.
#[tauri::command]
fn take_pending_open(state: tauri::State<'_, AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending_open.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let db = translate::init_db(app.handle()).map_err(|e| e.to_string())?;
            let mut pending = Vec::new();
            for arg in std::env::args().skip(1) {
                if !arg.starts_with('-') && std::path::Path::new(&arg).exists() {
                    let p = std::fs::canonicalize(&arg)
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or(arg);
                    pending.push(p);
                }
            }
            app.manage(AppState {
                db: Mutex::new(db),
                epoch: AtomicU64::new(0),
                pending_open: Mutex::new(pending),
                watcher: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_open,
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
                let state = app_handle.state::<AppState>();
                state.pending_open.lock().unwrap().extend(paths);
                let _ = app_handle.emit("open-file", ());
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            }
            _ => {}
        }
    });
}
