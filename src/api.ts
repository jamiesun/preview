import { invoke } from "@tauri-apps/api/core";

export type FileKind = "markdown" | "html" | "image" | "pdf" | "text" | "unknown" | "dir";

export interface FileInfo {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  kind: FileKind;
}

export interface FormatCatalogEntry {
  kind: Exclude<FileKind, "unknown" | "dir">;
  extensions: string[];
}

export interface TextDoc {
  content: string;
  encoding: string;
  truncated: boolean;
}

export interface MdSegment {
  id: number;
  kind: "text" | "code" | "html" | "rule" | "meta";
  source: string;
}

export interface MdDoc {
  html: string;
  segments: MdSegment[];
  refdefs: string;
  title: string | null;
  detectedLang: string | null;
}

export interface TrProgress {
  docKey: string;
  runId: string;
  seg: number;
  status: "done" | "error";
  cached: boolean;
  md: string | null;
  html: string | null;
  error: string | null;
}

export interface TrDone {
  docKey: string;
  runId: string;
  total: number;
  ok: number;
  cached: number;
  failed: number;
  cancelled: boolean;
}

export interface Settings {
  apiBase: string;
  apiKey: string;
  model: string;
  targetLang: string;
  concurrency: number;
  temperature: number;
  systemPrompt: string;
}

export interface CacheStats {
  entries: number;
  bytes: number;
}

export const detectFile = (path: string) => invoke<FileInfo>("detect_file", { path });
export const getFormatCatalog = () => invoke<FormatCatalogEntry[]>("get_format_catalog");
export const readTextFile = (path: string) => invoke<TextDoc>("read_text_file", { path });
export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });
export const renderMarkdown = (path: string) => invoke<MdDoc>("render_markdown", { path });
export const takePendingOpen = () => invoke<string[]>("take_pending_open");
export const watchFile = (path: string) => invoke<void>("watch_file", { path });
export const unwatchFile = () => invoke<void>("unwatch_file");
export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });
export const testLlm = (settings: Settings) => invoke<string>("test_llm_connection", { settings });
export const openSettingsWindow = () => invoke<void>("open_settings_window");
export const translateDoc = (
  docKey: string,
  runId: string,
  segments: { id: number; source: string }[],
  refdefs: string,
  targetLang?: string,
) =>
  invoke<TrDone>("translate_doc", {
    docKey,
    runId,
    segments,
    refdefs,
    targetLang: targetLang ?? null,
  });
export const cancelTranslate = (runId?: string) =>
  invoke<boolean>("cancel_translate", { runId: runId ?? null });
export const cacheStats = () => invoke<CacheStats>("translation_cache_stats");
export const clearCache = () => invoke<void>("clear_translation_cache");
