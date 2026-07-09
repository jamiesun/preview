use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
}

const MD_EXTS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdwn"];
const HTML_EXTS: &[&str] = &["html", "htm", "xhtml"];
const IMG_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tif", "tiff", "avif", "heic",
    "heif",
];

fn ext_of(p: &Path) -> String {
    p.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn kind_by_ext(ext: &str) -> Option<&'static str> {
    if MD_EXTS.contains(&ext) {
        Some("markdown")
    } else if HTML_EXTS.contains(&ext) {
        Some("html")
    } else if IMG_EXTS.contains(&ext) {
        Some("image")
    } else if ext == "pdf" {
        Some("pdf")
    } else {
        None
    }
}

/// Heuristic: a file is "text" if its first 8 KiB contain no NUL byte.
fn looks_like_text(path: &Path) -> bool {
    let mut buf = [0u8; 8192];
    match fs::File::open(path).and_then(|mut f| f.read(&mut buf)) {
        Ok(n) => !buf[..n].contains(&0),
        Err(_) => false,
    }
}

pub fn kind_of(path: &Path) -> String {
    let ext = ext_of(path);
    if let Some(k) = kind_by_ext(&ext) {
        return k.to_string();
    }
    if looks_like_text(path) {
        "text".to_string()
    } else {
        "unknown".to_string()
    }
}

#[tauri::command]
pub fn detect_file(path: String) -> Result<FileInfo, String> {
    let p = Path::new(&path);
    let meta = fs::metadata(p).map_err(|e| format!("无法读取文件: {e}"))?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    if meta.is_dir() {
        return Ok(FileInfo {
            kind: "dir".into(),
            name,
            size: 0,
            path,
        });
    }
    Ok(FileInfo {
        kind: kind_of(p),
        name,
        size: meta.len(),
        path,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub kind: String,
}

/// Lists one directory level (used by the sidebar tree, which lazy-loads
/// children on expand). Hidden entries are skipped; directories sort first.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out: Vec<DirEntry> = Vec::new();
    let rd = fs::read_dir(&path).map_err(|e| format!("无法读取目录: {e}"))?;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let p = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let kind = if is_dir {
            "dir".to_string()
        } else {
            // Extension-only here: sniffing every file would slow large trees.
            kind_by_ext(&ext_of(&p)).unwrap_or("file").to_string()
        };
        out.push(DirEntry {
            name,
            path: p.to_string_lossy().into_owned(),
            is_dir,
            kind,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDoc {
    pub content: String,
    pub encoding: String,
    pub truncated: bool,
}

const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;

pub fn read_decoded(path: &Path, cap: u64) -> Result<TextDoc, String> {
    let meta = fs::metadata(path).map_err(|e| format!("无法读取文件: {e}"))?;
    let truncated = meta.len() > cap;
    let f = fs::File::open(path).map_err(|e| format!("无法打开文件: {e}"))?;
    let mut bytes = Vec::with_capacity(meta.len().min(cap) as usize);
    f.take(cap)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取失败: {e}"))?;

    let mut det = chardetng::EncodingDetector::new();
    det.feed(&bytes, true);
    let guessed = det.guess(None, true);
    // `decode` BOM-sniffs first, so UTF-8/UTF-16 BOMs override the guess.
    let (cow, actual, _malformed) = guessed.decode(&bytes);
    Ok(TextDoc {
        content: cow.into_owned(),
        encoding: actual.name().to_string(),
        truncated,
    })
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextDoc, String> {
    read_decoded(Path::new(&path), MAX_TEXT_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_by_extension() {
        assert_eq!(kind_of(Path::new("/tmp/a.md")), "markdown");
        assert_eq!(kind_of(Path::new("/tmp/a.HTML")), "html");
        assert_eq!(kind_of(Path::new("/tmp/a.PNG")), "image");
        assert_eq!(kind_of(Path::new("/tmp/a.pdf")), "pdf");
    }

    #[test]
    fn list_dir_sorts_and_hides_dotfiles() {
        let dir = std::env::temp_dir().join("preview_test_listdir");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("zeta")).unwrap();
        fs::write(dir.join("b.md"), "x").unwrap();
        fs::write(dir.join("A.png"), "x").unwrap();
        fs::write(dir.join(".hidden"), "x").unwrap();
        let entries = list_dir(dir.to_string_lossy().into_owned()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["zeta", "A.png", "b.md"]);
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].kind, "image");
        assert_eq!(entries[2].kind, "markdown");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn decodes_utf8_and_gbk() {
        let dir = std::env::temp_dir();
        let p1 = dir.join("preview_test_utf8.txt");
        fs::write(&p1, "你好 world").unwrap();
        let d = read_decoded(&p1, 1024).unwrap();
        assert_eq!(d.content, "你好 world");
        assert!(!d.truncated);

        let p2 = dir.join("preview_test_gbk.txt");
        let (gbk, _, _) = encoding_rs::GBK.encode("中文编码测试，你好");
        fs::write(&p2, &gbk).unwrap();
        let d2 = read_decoded(&p2, 1024).unwrap();
        assert_eq!(d2.content, "中文编码测试，你好");
        let _ = fs::remove_file(p1);
        let _ = fs::remove_file(p2);
    }
}
