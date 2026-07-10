use pulldown_cmark::{html, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use std::fmt::Write as _;
use std::path::Path;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: usize,
    /// "text" | "code" | "html" | "rule" | "meta"
    pub kind: String,
    pub source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdDoc {
    pub html: String,
    pub segments: Vec<Segment>,
    /// Reconstructed reference link definitions, appended when rendering
    /// translated fragments so `[text][ref]` links keep resolving.
    pub refdefs: String,
    pub title: Option<String>,
    /// Human-readable label of the detected source language, e.g. "中文".
    pub detected_lang: Option<String>,
}

fn md_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
}

fn refdefs_of(parser: &Parser) -> String {
    let mut out = String::new();
    for (label, def) in parser.reference_definitions().iter() {
        let title = def
            .title
            .as_ref()
            .map(|t| format!(" \"{}\"", t.replace('"', "\\\"")))
            .unwrap_or_default();
        let _ = writeln!(out, "[{}]: {}{}", label, def.dest, title);
    }
    out
}

fn flush_segment(
    segments: &mut Vec<Segment>,
    html_out: &mut String,
    events: Vec<Event>,
    kind: &str,
    source: &str,
) {
    let id = segments.len();
    let mut frag = String::new();
    html::push_html(&mut frag, events.into_iter());
    let _ = write!(
        html_out,
        "<section class=\"seg\" data-seg=\"{id}\" data-kind=\"{kind}\"><div class=\"seg-src\">{frag}</div></section>\n"
    );
    segments.push(Segment {
        id,
        kind: kind.to_string(),
        source: source.trim().to_string(),
    });
}

/// Renders a full document, split into top-level block segments so the
/// translation pipeline can address, cache and replace blocks individually.
pub fn render_document_str(src: &str) -> MdDoc {
    let parser = Parser::new_ext(src, md_options());
    let refdefs = refdefs_of(&parser);

    let mut segments = Vec::new();
    let mut html_out = String::new();
    let mut title: Option<String> = None;

    let mut depth = 0usize;
    let mut seg_events: Vec<Event> = Vec::new();
    let mut seg_start = 0usize;
    let mut seg_kind = "text";
    let mut in_title = false;
    let mut title_buf = String::new();

    for (ev, range) in parser.into_offset_iter() {
        match ev {
            Event::Start(ref tag) => {
                if depth == 0 {
                    seg_start = range.start;
                    seg_kind = match tag {
                        Tag::CodeBlock(_) => "code",
                        Tag::MetadataBlock(_) => "meta",
                        Tag::HtmlBlock => "html",
                        _ => "text",
                    };
                }
                if title.is_none()
                    && matches!(
                        tag,
                        Tag::Heading {
                            level: HeadingLevel::H1,
                            ..
                        }
                    )
                {
                    in_title = true;
                    title_buf.clear();
                }
                depth += 1;
                seg_events.push(ev);
            }
            Event::End(ref tag_end) => {
                depth -= 1;
                if in_title && matches!(tag_end, TagEnd::Heading(HeadingLevel::H1)) {
                    in_title = false;
                    let t = title_buf.trim();
                    if !t.is_empty() {
                        title = Some(t.to_string());
                    }
                }
                seg_events.push(ev);
                if depth == 0 {
                    let source = &src[seg_start..range.end.min(src.len())];
                    flush_segment(
                        &mut segments,
                        &mut html_out,
                        std::mem::take(&mut seg_events),
                        seg_kind,
                        source,
                    );
                }
            }
            other => {
                if in_title {
                    if let Event::Text(t) | Event::Code(t) = &other {
                        title_buf.push_str(t);
                    }
                }
                if depth == 0 {
                    // Standalone top-level event, e.g. a thematic break.
                    let kind = if matches!(other, Event::Rule) {
                        "rule"
                    } else {
                        "text"
                    };
                    let source = &src[range.start..range.end.min(src.len())];
                    flush_segment(&mut segments, &mut html_out, vec![other], kind, source);
                } else {
                    seg_events.push(other);
                }
            }
        }
    }

    MdDoc {
        html: html_out,
        segments,
        refdefs,
        title,
        detected_lang: None,
    }
}

fn lang_label(lang: whatlang::Lang) -> &'static str {
    use whatlang::Lang::*;
    match lang {
        Cmn => "中文",
        Eng => "英文",
        Jpn => "日语",
        Kor => "韩语",
        Fra => "法语",
        Deu => "德语",
        Spa => "西语",
        Rus => "俄语",
        Por => "葡语",
        Ita => "意语",
        Ara => "阿拉伯语",
        Vie => "越南语",
        Tha => "泰语",
        Nld => "荷兰语",
        Tur => "土耳其语",
        Hin => "印地语",
        Ind => "印尼语",
        Ukr => "乌克兰语",
        Pol => "波兰语",
        Swe => "瑞典语",
        other => other.eng_name(),
    }
}

/// Detects the dominant language of the document's prose segments.
pub fn detect_lang_of(doc: &MdDoc) -> Option<String> {
    let sample: String = doc
        .segments
        .iter()
        .filter(|s| s.kind == "text")
        .map(|s| s.source.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(4000)
        .collect();
    if sample.trim().len() < 8 {
        return None;
    }
    let info = whatlang::detect(&sample)?;
    if info.confidence() < 0.2 {
        return None;
    }
    Some(lang_label(info.lang()).to_string())
}

/// Renders a markdown fragment (e.g. one translated segment) to HTML,
/// appending the document's reference definitions so links resolve.
pub fn render_fragment(md: &str, refdefs: &str) -> String {
    let full = if refdefs.trim().is_empty() {
        md.to_string()
    } else {
        format!("{md}\n\n{refdefs}")
    };
    let mut out = String::new();
    html::push_html(&mut out, Parser::new_ext(&full, md_options()));
    out
}

#[tauri::command]
pub fn render_markdown(path: String) -> Result<MdDoc, String> {
    let p = Path::new(&path);
    let doc = crate::fsx::read_decoded(p, 10 * 1024 * 1024)?;
    let mut md = render_document_str(&doc.content);
    md.detected_lang = detect_lang_of(&md);
    if md.title.is_none() {
        md.title = p
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned());
    }
    Ok(md)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# Hello\n\nFirst paragraph with *emphasis*.\n\n```rust\nfn main() {}\n```\n\n- item 1\n- item 2\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSee [docs][d].\n\n[d]: https://example.com \"Docs\"\n";

    #[test]
    fn segments_split_by_top_level_blocks() {
        let doc = render_document_str(SAMPLE);
        let kinds: Vec<&str> = doc.segments.iter().map(|s| s.kind.as_str()).collect();
        assert_eq!(
            kinds,
            vec!["text", "text", "code", "text", "rule", "text", "text"]
        );
        assert_eq!(doc.title.as_deref(), Some("Hello"));
        assert!(doc.segments[2].source.contains("fn main"));
        assert_eq!(doc.html.matches("data-seg=").count(), doc.segments.len());
    }

    #[test]
    fn refdefs_reconstructed_and_fragment_links_resolve() {
        let doc = render_document_str(SAMPLE);
        assert!(doc.refdefs.contains("[d]: https://example.com \"Docs\""));
        let html = render_fragment("查看[文档][d]。", &doc.refdefs);
        assert!(html.contains("href=\"https://example.com\""), "{html}");
    }

    #[test]
    fn full_html_contains_rendered_blocks() {
        let doc = render_document_str(SAMPLE);
        assert!(doc.html.contains("<h1>Hello</h1>"));
        assert!(doc.html.contains("<table>"));
        assert!(doc.html.contains("language-rust"));
        assert!(doc.html.contains("<hr />"));
    }

    #[test]
    fn front_matter_is_meta_segment() {
        let doc = render_document_str("---\ntitle: x\n---\n\nBody text.\n");
        assert_eq!(doc.segments[0].kind, "meta");
        assert_eq!(doc.segments[1].kind, "text");
    }

    #[test]
    fn tasklist_and_footnote_render() {
        let doc = render_document_str("- [x] done\n- [ ] todo\n\nRef[^1].\n\n[^1]: note\n");
        assert!(doc.html.contains("checkbox"));
        assert!(doc.html.contains("footnote"));
    }

    #[test]
    fn detects_source_language() {
        let zh = render_document_str(
            "# 标题\n\n这是一段用于语言检测的中文正文，包含足够多的汉字来保证检测的可靠性。\n\n第二段继续补充一些中文内容，例如翻译、缓存、渲染等词汇。\n",
        );
        assert_eq!(detect_lang_of(&zh).as_deref(), Some("中文"));

        let en = render_document_str(
            "# Title\n\nThis is an English paragraph long enough for reliable language detection, covering translation, caching and rendering.\n",
        );
        assert_eq!(detect_lang_of(&en).as_deref(), Some("英文"));

        let code_only = render_document_str("```rust\nfn main() {}\n```\n");
        assert_eq!(detect_lang_of(&code_only), None);
    }
}
