use crate::AppState;
use notify::{RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// Watches the file's parent directory (non-recursive) so atomic
/// save-via-rename from editors keeps working, and emits a debounced
/// `file-changed` event. Only one file is watched at a time.
#[tauri::command]
pub fn watch_file(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let parent = target
        .parent()
        .filter(|p| p.as_os_str().len() > 0)
        .ok_or("无法监听该路径")?
        .to_path_buf();
    let file_name = target
        .file_name()
        .ok_or("无法监听该路径")?
        .to_os_string();

    let last_emit = Mutex::new(Instant::now() - Duration::from_secs(1));
    let emitted_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let relevant = matches!(
            event.kind,
            notify::EventKind::Create(_) | notify::EventKind::Modify(_)
        ) && event
            .paths
            .iter()
            .any(|p| p.file_name() == Some(file_name.as_os_str()));
        if !relevant {
            return;
        }
        let mut last = last_emit.lock().unwrap();
        if last.elapsed() < Duration::from_millis(200) {
            return;
        }
        *last = Instant::now();
        let _ = app.emit("file-changed", &emitted_path);
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(state: State<'_, AppState>) {
    *state.watcher.lock().unwrap() = None;
}
