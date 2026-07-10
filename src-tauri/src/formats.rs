use serde::Serialize;
use std::path::Path;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Markdown,
    Html,
    Image,
    Pdf,
    Text,
    Unknown,
    Dir,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct FormatCatalogEntry {
    pub kind: FileKind,
    pub extensions: &'static [&'static str],
}

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdwn"];
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "text", "log", "json", "toml", "yaml", "yml", "css", "scss", "js", "mjs", "cjs", "ts",
    "py", "rb", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "swift", "sh", "bash",
    "zsh", "ini", "sql", "xml", "php", "lua", "diff", "patch",
];
const HTML_EXTENSIONS: &[&str] = &["html", "htm", "xhtml"];
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tif", "tiff", "avif", "heic", "heif",
];
const PDF_EXTENSIONS: &[&str] = &["pdf"];

/// Canonical catalog for built-in formats. Extension classification and the
/// frontend-facing catalog command both derive from this table.
pub const BUILTIN_FORMAT_CATALOG: &[FormatCatalogEntry] = &[
    FormatCatalogEntry {
        kind: FileKind::Markdown,
        extensions: MARKDOWN_EXTENSIONS,
    },
    FormatCatalogEntry {
        kind: FileKind::Text,
        extensions: TEXT_EXTENSIONS,
    },
    FormatCatalogEntry {
        kind: FileKind::Html,
        extensions: HTML_EXTENSIONS,
    },
    FormatCatalogEntry {
        kind: FileKind::Image,
        extensions: IMAGE_EXTENSIONS,
    },
    FormatCatalogEntry {
        kind: FileKind::Pdf,
        extensions: PDF_EXTENSIONS,
    },
];

pub fn kind_by_extension(extension: &str) -> Option<FileKind> {
    let extension = extension.trim_start_matches('.');
    BUILTIN_FORMAT_CATALOG.iter().find_map(|format| {
        format
            .extensions
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(extension))
            .then_some(format.kind)
    })
}

pub fn kind_by_path_extension(path: &Path) -> Option<FileKind> {
    path.extension()
        .and_then(|extension| kind_by_extension(&extension.to_string_lossy()))
}

#[tauri::command]
pub fn get_format_catalog() -> Vec<FormatCatalogEntry> {
    BUILTIN_FORMAT_CATALOG.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn file_kind_serializes_as_lowercase() {
        let cases = [
            (FileKind::Markdown, "\"markdown\""),
            (FileKind::Html, "\"html\""),
            (FileKind::Image, "\"image\""),
            (FileKind::Pdf, "\"pdf\""),
            (FileKind::Text, "\"text\""),
            (FileKind::Unknown, "\"unknown\""),
            (FileKind::Dir, "\"dir\""),
        ];
        for (kind, expected) in cases {
            assert_eq!(serde_json::to_string(&kind).unwrap(), expected);
        }
    }

    #[test]
    fn catalog_drives_case_insensitive_extension_classification() {
        assert_eq!(kind_by_extension("MD"), Some(FileKind::Markdown));
        assert_eq!(kind_by_extension(".JSON"), Some(FileKind::Text));
        assert_eq!(kind_by_extension("xHtMl"), Some(FileKind::Html));
        assert_eq!(kind_by_extension("PNG"), Some(FileKind::Image));
        assert_eq!(kind_by_extension("Pdf"), Some(FileKind::Pdf));
        assert_eq!(kind_by_extension("not-a-format"), None);
    }

    #[test]
    fn catalog_has_explicit_text_extensions_and_no_duplicates() {
        let catalog = get_format_catalog();
        let text = catalog
            .iter()
            .find(|format| format.kind == FileKind::Text)
            .unwrap();
        for extension in [
            "txt", "text", "log", "json", "toml", "yaml", "yml", "css", "scss", "js", "mjs", "cjs",
            "ts", "py", "rb", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "swift",
            "sh", "bash", "zsh", "ini", "sql", "xml", "php", "lua", "diff", "patch",
        ] {
            assert!(text.extensions.contains(&extension), "missing {extension}");
        }

        let mut seen = HashSet::new();
        for format in catalog {
            for extension in format.extensions {
                assert_eq!(*extension, extension.to_ascii_lowercase());
                assert!(seen.insert(*extension), "duplicate extension {extension}");
            }
        }
    }

    #[test]
    fn bundle_file_associations_cover_the_catalog() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let associated: HashSet<&str> = config["bundle"]["fileAssociations"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|association| association["ext"].as_array().unwrap())
            .map(|extension| extension.as_str().unwrap())
            .collect();

        for format in BUILTIN_FORMAT_CATALOG {
            for extension in format.extensions {
                assert!(
                    associated.contains(extension),
                    "bundle file association missing {extension}"
                );
            }
        }
    }
}
