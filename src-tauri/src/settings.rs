use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
    pub target_lang: String,
    pub concurrency: u32,
    pub temperature: f64,
    /// Optional custom system prompt; `{lang}` is replaced by the target language.
    pub system_prompt: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_base: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            model: "gpt-4o-mini".into(),
            target_lang: "简体中文".into(),
            concurrency: 3,
            temperature: 0.2,
            system_prompt: String::new(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    load(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let p = settings_path(&app)?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&p, json).map_err(|e| e.to_string())?;
    let _ = app.emit("settings-changed", &settings);
    Ok(())
}

#[tauri::command]
pub async fn test_llm_connection(settings: Settings) -> Result<String, String> {
    crate::translate::chat_once(
        &settings,
        "You are a connectivity probe.",
        "Reply with exactly: OK",
    )
    .await
}

#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("设置")
        .inner_size(560.0, 700.0)
        .min_inner_size(460.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_fill_missing_fields() {
        let s: Settings = serde_json::from_str(r#"{"model":"qwen3"}"#).unwrap();
        assert_eq!(s.model, "qwen3");
        assert_eq!(s.api_base, "https://api.openai.com/v1");
        assert_eq!(s.concurrency, 3);
        assert_eq!(s.target_lang, "简体中文");
    }

    #[test]
    fn roundtrip_camel_case() {
        let s = Settings::default();
        let j = serde_json::to_string(&s).unwrap();
        assert!(j.contains("apiBase"));
        assert!(j.contains("targetLang"));
        let back: Settings = serde_json::from_str(&j).unwrap();
        assert_eq!(back.api_base, s.api_base);
    }
}
