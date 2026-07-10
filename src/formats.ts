import type { FileKind, FormatCatalogEntry } from "./api";

export interface FormatPresentation {
  label: string;
  icon: string;
}

export const FORMAT_PRESENTATION: Record<FileKind, FormatPresentation> = {
  markdown: { label: "Markdown", icon: "📝" },
  text: { label: "文本", icon: "📄" },
  image: { label: "图片", icon: "🖼️" },
  html: { label: "HTML", icon: "🌐" },
  pdf: { label: "PDF", icon: "📕" },
  unknown: { label: "未知文件", icon: "📄" },
  dir: { label: "文件夹", icon: "📁" },
};

export function iconForKind(kind: FileKind): string {
  return FORMAT_PRESENTATION[kind].icon;
}

export function pickerExtensions(catalog: readonly FormatCatalogEntry[]): string[] {
  return [...new Set(catalog.flatMap((entry) => entry.extensions))].sort();
}

export const FALLBACK_PICKER_EXTENSIONS = [
  "md", "markdown", "mdown", "mkd", "mdwn",
  "txt", "text", "log", "json", "toml", "yaml", "yml", "css", "scss",
  "js", "mjs", "cjs", "ts", "py", "rb", "rs", "go", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "swift", "sh", "bash", "zsh", "ini",
  "sql", "xml", "php", "lua", "diff", "patch",
  "html", "htm", "xhtml",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tif", "tiff",
  "avif", "heic", "heif", "pdf",
];
