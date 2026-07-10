use crate::settings::Settings;
use crate::AppState;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;

pub fn init_db(app: &AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("translate-cache.sqlite"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS tr_cache (
             key TEXT PRIMARY KEY,
             model TEXT NOT NULL,
             target_lang TEXT NOT NULL,
             translated TEXT NOT NULL,
             created_at INTEGER NOT NULL
         );",
    )?;
    Ok(conn)
}

/// Content-addressed cache key: same model + language + source text ⇒ hit.
pub fn cache_key(model: &str, lang: &str, source: &str) -> String {
    let mut h = Sha256::new();
    for part in ["v1", model, lang, source] {
        h.update(part.as_bytes());
        h.update([0x1f]);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn cache_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT translated FROM tr_cache WHERE key = ?1",
        [key],
        |r| r.get(0),
    )
    .ok()
}

fn cache_put(conn: &Connection, key: &str, model: &str, lang: &str, text: &str) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO tr_cache (key, model, target_lang, translated, created_at)
         VALUES (?1, ?2, ?3, ?4, strftime('%s','now'))",
        rusqlite::params![key, model, lang, text],
    );
}

fn default_system_prompt(lang: &str) -> String {
    format!(
        "You are a professional translator. Translate the user's Markdown content into {lang}. \
         Preserve the Markdown structure exactly. Keep code blocks, inline code, URLs, link \
         destinations, and HTML tags unchanged; translate only human-readable text (including \
         link text). Output ONLY the translated Markdown, with no explanations, notes, or \
         surrounding code fences."
    )
}

/// Models sometimes wrap output in a spurious ```fence```; strip it unless the
/// source itself was a fenced block.
fn strip_wrapping_fence(source: &str, out: &str) -> String {
    let t = out.trim();
    if source.trim_start().starts_with("```") || !t.starts_with("```") {
        return t.to_string();
    }
    let lines: Vec<&str> = t.lines().collect();
    if lines.len() >= 2 && lines.last().map_or(false, |l| l.trim() == "```") {
        return lines[1..lines.len() - 1].join("\n");
    }
    t.to_string()
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())
}

async fn chat(
    client: &reqwest::Client,
    s: &Settings,
    system: &str,
    user: &str,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", s.api_base.trim_end_matches('/'));
    // No token-limit parameter: `max_tokens` vs `max_completion_tokens` support
    // varies across OpenAI-compatible backends (Azure gpt-5.x rejects the former).
    let body = serde_json::json!({
        "model": s.model,
        "temperature": s.temperature,
        "stream": false,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ]
    });
    let mut req = client.post(&url).json(&body);
    if !s.api_key.is_empty() {
        req = req.bearer_auth(&s.api_key);
    }
    let resp = req.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let brief: String = text.chars().take(300).collect();
        return Err(format!("HTTP {}: {}", status.as_u16(), brief));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("响应解析失败: {e}"))?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .map(|c| c.to_string())
        .ok_or_else(|| {
            let brief: String = text.chars().take(300).collect();
            format!("响应缺少内容: {brief}")
        })
}

pub async fn chat_once(s: &Settings, system: &str, user: &str) -> Result<String, String> {
    let client = http_client()?;
    chat(&client, s, system, user).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentIn {
    pub id: usize,
    pub source: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrProgress {
    pub doc_key: String,
    pub seg: usize,
    /// "done" | "error"
    pub status: String,
    pub cached: bool,
    pub md: Option<String>,
    pub html: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrDone {
    pub doc_key: String,
    pub total: usize,
    pub ok: usize,
    pub cached: usize,
    pub failed: usize,
    pub cancelled: bool,
}

/// Translates segments concurrently. Progress streams to the frontend via
/// `translate-progress` events; a `translate-done` summary follows. Starting a
/// new run (or `cancel_translate`) bumps the epoch and voids in-flight work.
#[tauri::command]
pub async fn translate_doc(
    app: AppHandle,
    doc_key: String,
    segments: Vec<SegmentIn>,
    refdefs: Option<String>,
    target_lang: Option<String>,
) -> Result<TrDone, String> {
    let settings = crate::settings::load(&app);
    if settings.api_key.is_empty() && settings.api_base.starts_with("https://api.openai.com") {
        return Err("尚未配置 API Key，请先打开设置窗口填写".into());
    }
    let lang = target_lang
        .filter(|l| !l.trim().is_empty())
        .unwrap_or_else(|| settings.target_lang.clone());
    let refdefs = refdefs.unwrap_or_default();
    let sys = if settings.system_prompt.trim().is_empty() {
        default_system_prompt(&lang)
    } else {
        settings.system_prompt.replace("{lang}", &lang)
    };

    let epoch = {
        let st = app.state::<AppState>();
        st.epoch.fetch_add(1, Ordering::SeqCst) + 1
    };
    let sem = Arc::new(Semaphore::new(settings.concurrency.clamp(1, 8) as usize));
    let client = http_client()?;

    let total = segments.len();
    let mut ok = 0usize;
    let mut cached_n = 0usize;
    let mut failed = 0usize;
    let mut handles = Vec::new();

    for seg in segments {
        let key = cache_key(&settings.model, &lang, &seg.source);
        let hit = {
            let st = app.state::<AppState>();
            let db = st.db.lock().unwrap();
            cache_get(&db, &key)
        };
        if let Some(md) = hit {
            ok += 1;
            cached_n += 1;
            let _ = app.emit(
                "translate-progress",
                TrProgress {
                    doc_key: doc_key.clone(),
                    seg: seg.id,
                    status: "done".into(),
                    cached: true,
                    html: Some(crate::markdown::render_fragment(&md, &refdefs)),
                    md: Some(md),
                    error: None,
                },
            );
            continue;
        }

        let (app2, sem2, sys2, s2, lang2, dk, rd, client2) = (
            app.clone(),
            sem.clone(),
            sys.clone(),
            settings.clone(),
            lang.clone(),
            doc_key.clone(),
            refdefs.clone(),
            client.clone(),
        );
        handles.push(tauri::async_runtime::spawn(async move {
            let _permit = sem2.acquire().await;
            let st = app2.state::<AppState>();
            if st.epoch.load(Ordering::SeqCst) != epoch {
                return None; // cancelled before start
            }
            match chat(&client2, &s2, &sys2, &seg.source).await {
                Ok(out) => {
                    let md = strip_wrapping_fence(&seg.source, &out);
                    {
                        let db = st.db.lock().unwrap();
                        cache_put(&db, &key, &s2.model, &lang2, &md);
                    }
                    if st.epoch.load(Ordering::SeqCst) == epoch {
                        let _ = app2.emit(
                            "translate-progress",
                            TrProgress {
                                doc_key: dk,
                                seg: seg.id,
                                status: "done".into(),
                                cached: false,
                                html: Some(crate::markdown::render_fragment(&md, &rd)),
                                md: Some(md),
                                error: None,
                            },
                        );
                    }
                    Some(true)
                }
                Err(e) => {
                    if st.epoch.load(Ordering::SeqCst) == epoch {
                        let _ = app2.emit(
                            "translate-progress",
                            TrProgress {
                                doc_key: dk,
                                seg: seg.id,
                                status: "error".into(),
                                cached: false,
                                md: None,
                                html: None,
                                error: Some(e),
                            },
                        );
                    }
                    Some(false)
                }
            }
        }));
    }

    for h in handles {
        match h.await {
            Ok(Some(true)) => ok += 1,
            Ok(Some(false)) => failed += 1,
            _ => {}
        }
    }

    let cancelled = {
        let st = app.state::<AppState>();
        st.epoch.load(Ordering::SeqCst) != epoch
    };
    let done = TrDone {
        doc_key,
        total,
        ok,
        cached: cached_n,
        failed,
        cancelled,
    };
    let _ = app.emit("translate-done", done.clone());
    Ok(done)
}

#[tauri::command]
pub fn cancel_translate(state: State<'_, AppState>) {
    state.epoch.fetch_add(1, Ordering::SeqCst);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub entries: i64,
    pub bytes: i64,
}

#[tauri::command]
pub fn translation_cache_stats(state: State<'_, AppState>) -> Result<CacheStats, String> {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT COUNT(*), COALESCE(SUM(LENGTH(translated)), 0) FROM tr_cache",
        [],
        |r| {
            Ok(CacheStats {
                entries: r.get(0)?,
                bytes: r.get(1)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_translation_cache(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM tr_cache", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_stable_and_discriminating() {
        let a = cache_key("m1", "zh", "hello");
        assert_eq!(a, cache_key("m1", "zh", "hello"));
        assert_ne!(a, cache_key("m2", "zh", "hello"));
        assert_ne!(a, cache_key("m1", "en", "hello"));
        assert_ne!(a, cache_key("m1", "zh", "hello!"));
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn cache_roundtrip_in_memory() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tr_cache (key TEXT PRIMARY KEY, model TEXT NOT NULL,
             target_lang TEXT NOT NULL, translated TEXT NOT NULL, created_at INTEGER NOT NULL);",
        )
        .unwrap();
        let k = cache_key("m", "zh", "src");
        assert!(cache_get(&conn, &k).is_none());
        cache_put(&conn, &k, "m", "zh", "译文");
        assert_eq!(cache_get(&conn, &k).as_deref(), Some("译文"));
    }

    #[test]
    fn strips_spurious_fences_only() {
        assert_eq!(
            strip_wrapping_fence("plain text", "```markdown\n你好\n```"),
            "你好"
        );
        assert_eq!(strip_wrapping_fence("plain", "你好"), "你好");
        // Source was itself a fence: keep model output untouched.
        let src = "```rust\nfn main() {}\n```";
        let out = "```rust\nfn main() {}\n```";
        assert_eq!(strip_wrapping_fence(src, out), out);
    }

    fn spawn_mock_llm(status: u16, body: &'static str) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { continue };
                let mut buf = [0u8; 65536];
                let _ = s.read(&mut buf);
                let resp = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(resp.as_bytes());
            }
        });
        format!("http://{addr}/v1")
    }

    #[tokio::test]
    async fn chat_parses_openai_compatible_response() {
        let base = spawn_mock_llm(
            200,
            r#"{"choices":[{"message":{"role":"assistant","content":"你好，世界"}}]}"#,
        );
        let s = Settings {
            api_base: base,
            api_key: "test-key".into(),
            ..Default::default()
        };
        let out = chat_once(&s, "sys", "hello").await.unwrap();
        assert_eq!(out, "你好，世界");
    }

    #[tokio::test]
    async fn chat_surfaces_http_errors() {
        let base = spawn_mock_llm(500, r#"{"error":{"message":"boom"}}"#);
        let s = Settings {
            api_base: base,
            api_key: "test-key".into(),
            ..Default::default()
        };
        let err = chat_once(&s, "sys", "hello").await.unwrap_err();
        assert!(err.contains("HTTP 500"), "{err}");
        assert!(err.contains("boom"), "{err}");
    }
}
