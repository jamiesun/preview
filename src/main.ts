import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, confirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText, writeHtml } from "@tauri-apps/plugin-clipboard-manager";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";
import "./styles.css";
import * as api from "./api";

type TrMode = "off" | "bilingual" | "replace";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const content = $("#content");
const fileNameEl = $("#file-name");
const trStatusEl = $("#tr-status");
const trSwitch = $("#tr-switch");
const srcLangEl = $("#src-lang");
const dstLangEl = $("#dst-lang");
const langMenu = $("#lang-menu");
const copyMenu = $("#copy-menu");
const copyBtn = $("#btn-copy");
const appearanceMenu = $("#appearance-menu");
const mdTools = $("#md-tools");
const imgTools = $("#img-tools");
const zoomLabel = $("#img-zoom-label");
const toast = $("#toast");
const sidebar = $("#sidebar");
const treeEl = $("#tree");
const sbRoot = $("#sb-root");

const state = {
  path: null as string | null,
  kind: "" as string,
  folder: null as string | null,
  doc: null as api.MdDoc | null,
  mode: "off" as TrMode,
  targetLang: "简体中文",
  translating: false,
  translations: new Map<number, { md: string; html: string }>(),
  failed: new Map<number, string>(),
  imgZoom: 1,
  imgRot: 0,
  imgFit: true,
};

const LANGS: { value: string; label: string }[] = [
  { value: "简体中文", label: "中文" },
  { value: "English", label: "英文" },
  { value: "繁體中文", label: "繁中" },
  { value: "日本語", label: "日语" },
  { value: "한국어", label: "韩语" },
  { value: "Français", label: "法语" },
  { value: "Deutsch", label: "德语" },
  { value: "Español", label: "西语" },
  { value: "Русский", label: "俄语" },
];

function langLabel(value: string): string {
  return LANGS.find((l) => l.value === value)?.label ?? value;
}

// ---------------------------------------------------------------- appearance

type Theme = "auto" | "light" | "dark";
type FontKind = "system" | "serif" | "mono";

interface Appearance {
  theme: Theme;
  font: FontKind;
  fontSize: number;
  width: number;
}

const FONT_STACKS: Record<FontKind, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif CJK SC", serif',
  mono: '"SF Mono", ui-monospace, Menlo, Consolas, "PingFang SC", monospace',
};

const DEFAULT_APPEARANCE: Appearance = { theme: "auto", font: "system", fontSize: 15, width: 860 };

function loadAppearance(): Appearance {
  try {
    return { ...DEFAULT_APPEARANCE, ...JSON.parse(localStorage.getItem("preview-appearance") ?? "{}") };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

const appearance = loadAppearance();

function effectiveTheme(): "light" | "dark" {
  return appearance.theme === "auto" ? (darkMq.matches ? "dark" : "light") : appearance.theme;
}

function applyAppearance() {
  const root = document.documentElement;
  const theme = effectiveTheme();
  const themeChanged = root.dataset.theme !== theme;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.setProperty("--md-width", appearance.width >= 1400 ? "100%" : `${appearance.width}px`);
  root.style.setProperty("--md-font-size", `${appearance.fontSize}px`);
  root.style.setProperty("--md-font", FONT_STACKS[appearance.font]);
  localStorage.setItem("preview-appearance", JSON.stringify(appearance));
  syncAppearanceUi();
  if (themeChanged) refreshMermaidTheme();
}

function syncAppearanceUi() {
  appearanceMenu.querySelectorAll<HTMLElement>("#ap-theme .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.value === appearance.theme);
  });
  appearanceMenu.querySelectorAll<HTMLElement>("#ap-font .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.value === appearance.font);
  });
  $("#ap-font-val").textContent = String(appearance.fontSize);
  ($("#ap-width") as unknown as HTMLInputElement).value = String(appearance.width);
  $("#ap-width-val").textContent = appearance.width >= 1400 ? "全宽" : String(appearance.width);
}

function bumpFontSize(delta: number) {
  appearance.fontSize = Math.min(28, Math.max(11, appearance.fontSize + delta));
  applyAppearance();
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 4000);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function highlightIn(el: HTMLElement) {
  el.querySelectorAll("pre code").forEach((b) => {
    if (!(b as HTMLElement).classList.contains("language-mermaid")) {
      hljs.highlightElement(b as HTMLElement);
    }
  });
}

// ---------------------------------------------------------------- mermaid

const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
let mermaidMod: typeof import("mermaid").default | null = null;
let mermaidSeq = 0;

async function getMermaid() {
  if (!mermaidMod) {
    mermaidMod = (await import("mermaid")).default;
    mermaidMod.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: effectiveTheme() === "dark" ? "dark" : "default",
    });
  }
  return mermaidMod;
}

async function renderMermaidIn(root: HTMLElement) {
  const blocks = Array.from(root.querySelectorAll("pre code.language-mermaid"));
  if (blocks.length === 0) return;
  const mermaid = await getMermaid();
  for (const code of blocks) {
    const pre = code.closest("pre");
    if (!pre) continue;
    const src = code.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, src);
      const fig = document.createElement("div");
      fig.className = "mermaid-fig";
      fig.dataset.src = src;
      fig.innerHTML = svg;
      pre.replaceWith(fig);
    } catch (e) {
      const err = document.createElement("div");
      err.className = "mermaid-err";
      err.textContent = `Mermaid 渲染失败：${String(e).split("\n")[0]}`;
      pre.before(err);
    }
  }
}

async function refreshMermaidTheme() {
  if (!mermaidMod) return;
  mermaidMod.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: effectiveTheme() === "dark" ? "dark" : "default",
  });
  for (const fig of Array.from(content.querySelectorAll(".mermaid-fig"))) {
    const src = (fig as HTMLElement).dataset.src ?? "";
    try {
      const { svg } = await mermaidMod.render(`mmd-${++mermaidSeq}`, src);
      fig.innerHTML = svg;
    } catch {
      /* keep previous rendering */
    }
  }
}

darkMq.addEventListener("change", () => {
  if (appearance.theme === "auto") applyAppearance();
});

function showMessage(msg: string, sub = "") {
  content.innerHTML = `<div class="empty"><div class="empty-icon">⚠︎</div><p>${escapeHtml(msg)}</p>${
    sub ? `<p class="hint">${escapeHtml(sub)}</p>` : ""
  }</div>`;
}

function showTools(kind: string) {
  mdTools.classList.toggle("hidden", kind !== "markdown");
  imgTools.classList.toggle("hidden", kind !== "image");
  copyBtn.classList.toggle("hidden", kind !== "markdown" && kind !== "text");
}

// ---------------------------------------------------------------- file open

async function loadFile(path: string, opts: { keepScroll?: boolean } = {}) {
  const scrollTop = opts.keepScroll ? content.scrollTop : 0;
  try {
    const info = await api.detectFile(path);
    if (info.kind === "dir") {
      await openFolder(info.path);
      return;
    }
    state.path = info.path;
    state.kind = info.kind;
    fileNameEl.textContent = info.name;
    fileNameEl.title = info.path;
    document.title = `${info.name} — Preview`;
    showTools(info.kind);

    switch (info.kind) {
      case "markdown":
        await showMarkdown(info);
        break;
      case "text":
        await showText(info);
        break;
      case "image":
        showImage(info);
        break;
      case "html":
        showHtml(info);
        break;
      case "pdf":
        showMessage("PDF 预览将在后续版本支持", "见 ROADMAP.md · M3（pdf.js 集成）");
        break;
      default:
        showMessage("暂不支持该文件类型", info.name);
    }
    if (opts.keepScroll) content.scrollTop = scrollTop;
    api.watchFile(info.path).catch(() => {});
    markActiveTreeRow(info.path);
  } catch (e) {
    showMessage(String(e));
  }
}

async function pickFile() {
  const picked = await openDialog({
    multiple: false,
    title: "选择要预览的文件",
    filters: [
      {
        name: "支持的文件",
        extensions: [
          "md", "markdown", "txt", "log", "json", "toml", "yaml", "yml",
          "html", "htm", "css", "js", "ts", "py", "rs", "go", "sh",
          "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "pdf",
        ],
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (typeof picked === "string") loadFile(picked);
}

async function pickFolder() {
  const picked = await openDialog({ directory: true, multiple: false, title: "选择文件夹" });
  if (typeof picked === "string") openFolder(picked);
}

// ---------------------------------------------------------------- sidebar tree

function basename(p: string): string {
  return p.replace(/\/+$/, "").split("/").pop() ?? p;
}

function iconFor(en: api.DirEntry): string {
  if (en.isDir) return "📁";
  switch (en.kind) {
    case "markdown": return "📝";
    case "image": return "🖼️";
    case "html": return "🌐";
    case "pdf": return "📕";
    default: return "📄";
  }
}

async function buildTreeLevel(dir: string): Promise<HTMLElement> {
  const entries = await api.listDir(dir);
  const ul = document.createElement("ul");
  ul.className = "tree-level";
  for (const en of entries) {
    const li = document.createElement("li");
    li.className = "tree-node";
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.path = en.path;
    if (en.isDir) row.dataset.dir = "1";
    row.title = en.name;
    row.innerHTML =
      `<span class="tw">${en.isDir ? "▸" : ""}</span>` +
      `<span class="ti">${iconFor(en)}</span>` +
      `<span class="tn">${escapeHtml(en.name)}</span>`;
    li.appendChild(row);
    ul.appendChild(li);
  }
  return ul;
}

async function openFolder(dir: string) {
  try {
    const level = await buildTreeLevel(dir);
    state.folder = dir;
    sbRoot.textContent = basename(dir);
    sbRoot.title = dir;
    treeEl.innerHTML = "";
    treeEl.appendChild(level);
    sidebar.classList.remove("hidden");
    if (state.path) markActiveTreeRow(state.path);
  } catch (e) {
    showToast(String(e));
  }
}

function markActiveTreeRow(path: string) {
  treeEl.querySelectorAll(".tree-row.active").forEach((el) => el.classList.remove("active"));
  treeEl.querySelectorAll<HTMLElement>(".tree-row").forEach((row) => {
    if (row.dataset.path === path) row.classList.add("active");
  });
}

treeEl.addEventListener("click", async (e) => {
  const row = (e.target as HTMLElement).closest(".tree-row") as HTMLElement | null;
  if (!row?.dataset.path) return;
  const li = row.parentElement as HTMLElement;
  if (row.dataset.dir) {
    const existing = li.querySelector(":scope > .tree-level") as HTMLElement | null;
    if (existing) {
      existing.classList.toggle("hidden");
      row.classList.toggle("open", !existing.classList.contains("hidden"));
    } else {
      row.classList.add("open");
      try {
        li.appendChild(await buildTreeLevel(row.dataset.path));
      } catch (err) {
        row.classList.remove("open");
        showToast(String(err));
      }
    }
  } else {
    loadFile(row.dataset.path);
  }
});

function toggleSidebar() {
  if (!state.folder) {
    pickFolder();
    return;
  }
  sidebar.classList.toggle("hidden");
}

$("#btn-sidebar").addEventListener("click", toggleSidebar);
$("#sb-close").addEventListener("click", () => sidebar.classList.add("hidden"));

// draggable sidebar width
{
  const resizer = $("#sb-resizer");
  const saved = Number(localStorage.getItem("preview-sbw"));
  if (saved >= 180 && saved <= 520) {
    document.documentElement.style.setProperty("--sb-w", `${saved}px`);
  }
  let dragging = false;
  resizer.addEventListener("mousedown", (e) => {
    dragging = true;
    e.preventDefault();
    document.body.style.cursor = "col-resize";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const w = Math.min(520, Math.max(180, e.clientX));
    document.documentElement.style.setProperty("--sb-w", `${w}px`);
  });
  window.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    const w = Math.min(520, Math.max(180, e.clientX));
    localStorage.setItem("preview-sbw", String(w));
  });
}

// ---------------------------------------------------------------- markdown

async function showMarkdown(info: api.FileInfo) {
  // Void any in-flight translation run so late events can't pollute the new render.
  await api.cancelTranslate().catch(() => {});
  trRun++;
  state.translating = false;
  const doc = await api.renderMarkdown(info.path);
  state.doc = doc;
  state.translations.clear();
  state.failed.clear();
  srcLangEl.textContent = doc.detectedLang ? `·${doc.detectedLang}` : "";
  if (doc.title) document.title = `${doc.title} — Preview`;
  content.innerHTML = `<article class="markdown-body" data-trmode="${state.mode}">${doc.html}</article>`;
  highlightIn(content);
  injectSegTools();
  renderMermaidIn(content);
  updateTrStatus();
  if (state.mode !== "off") startTranslate();
}

function translatableSegs(): api.MdSegment[] {
  if (!state.doc) return [];
  return state.doc.segments.filter((s) => s.kind === "text" && s.source.trim().length > 0);
}

function segEl(id: number): HTMLElement | null {
  return content.querySelector(`section.seg[data-seg="${id}"]`);
}

function upsertSegTranslation(id: number, html: string) {
  const seg = segEl(id);
  if (!seg) return;
  seg.querySelector(".seg-tr")?.remove();
  seg.querySelector(".seg-err")?.remove();
  const div = document.createElement("div");
  div.className = "seg-tr";
  div.innerHTML = html;
  seg.appendChild(div);
  highlightIn(div);
  renderMermaidIn(div);
}

function upsertSegError(id: number, error: string) {
  const seg = segEl(id);
  if (!seg) return;
  seg.querySelector(".seg-err")?.remove();
  const div = document.createElement("div");
  div.className = "seg-err";
  div.innerHTML = `<span>翻译失败：${escapeHtml(error)}</span> <a href="#" data-retry="${id}">重试</a>`;
  seg.appendChild(div);
}

let trRun = 0;

async function startTranslate(onlyIds?: number[]) {
  if (!state.doc || !state.path || state.translating) return;
  const segs = translatableSegs().filter(
    (s) => !state.translations.has(s.id) && (!onlyIds || onlyIds.includes(s.id)),
  );
  if (segs.length === 0) {
    updateTrStatus();
    return;
  }
  const run = ++trRun;
  state.translating = true;
  updateTrStatus();
  try {
    await api.translateDoc(
      state.path,
      segs.map((s) => ({ id: s.id, source: s.source })),
      state.doc.refdefs,
      state.targetLang,
    );
  } catch (e) {
    showToast(String(e));
  } finally {
    if (run === trRun) {
      state.translating = false;
      updateTrStatus();
    }
  }
}

function applyMode() {
  const article = content.querySelector(".markdown-body") as HTMLElement | null;
  if (article) article.dataset.trmode = state.mode;
}

function updateTrStatus() {
  if (state.kind !== "markdown" || state.mode === "off") {
    trStatusEl.textContent = "";
    return;
  }
  const total = translatableSegs().length;
  const done = state.translations.size;
  const failed = state.failed.size;
  let text = `${done}/${total}`;
  if (failed > 0) text += ` · ${failed} 失败`;
  trStatusEl.textContent = state.translating ? `翻译中 ${text}` : text;
}

function setMode(mode: TrMode) {
  state.mode = mode;
  trSwitch.querySelectorAll(".seg-btn").forEach((b) => {
    b.classList.toggle("active", (b as HTMLElement).dataset.mode === mode);
  });
  applyMode();
  updateTrStatus();
  if (mode !== "off") startTranslate();
}

trSwitch.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.id === "lang-caret") return; // handled by the menu toggle
  const btn = target.closest(".seg-btn") as HTMLElement | null;
  if (btn?.dataset.mode) setMode(btn.dataset.mode as TrMode);
});

// ---- target language menu

function renderLangMenu() {
  langMenu.innerHTML = LANGS.map(
    (l) =>
      `<div class="menu-item${l.value === state.targetLang ? " checked" : ""}" data-lang="${l.value}">${
        l.label
      }<span class="menu-sub">${l.value}</span></div>`,
  ).join("");
}

function clearTranslationsDom() {
  content.querySelectorAll(".seg-tr, .seg-err").forEach((el) => el.remove());
  state.translations.clear();
  state.failed.clear();
}

async function applyLang(value: string, opts: { save?: boolean } = {}) {
  if (value === state.targetLang) return;
  state.targetLang = value;
  dstLangEl.textContent = `·${langLabel(value)}`;
  if (opts.save) {
    try {
      const s = await api.getSettings();
      await api.saveSettings({ ...s, targetLang: value });
    } catch {
      /* keep the session-local language even if persisting fails */
    }
  }
  await api.cancelTranslate().catch(() => {});
  trRun++;
  state.translating = false;
  clearTranslationsDom();
  updateTrStatus();
  if (state.mode !== "off") startTranslate();
}

$("#lang-caret").addEventListener("click", (e) => {
  e.stopPropagation();
  if (!langMenu.classList.contains("hidden")) {
    langMenu.classList.add("hidden");
    return;
  }
  renderLangMenu();
  const anchor = ($("#lang-caret") as HTMLElement).getBoundingClientRect();
  langMenu.style.top = `${anchor.bottom + 6}px`;
  langMenu.style.left = `${Math.min(anchor.left - 60, window.innerWidth - 180)}px`;
  langMenu.classList.remove("hidden");
});

langMenu.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest(".menu-item") as HTMLElement | null;
  if (item?.dataset.lang) {
    langMenu.classList.add("hidden");
    applyLang(item.dataset.lang, { save: true });
  }
});

document.addEventListener("click", (e) => {
  for (const menu of [langMenu, copyMenu, appearanceMenu]) {
    if (!menu.classList.contains("hidden") && !menu.contains(e.target as Node)) {
      menu.classList.add("hidden");
    }
  }
});

// ---------------------------------------------------------------- appearance panel

$("#btn-appearance").addEventListener("click", (e) => {
  e.stopPropagation();
  if (!appearanceMenu.classList.contains("hidden")) {
    appearanceMenu.classList.add("hidden");
    return;
  }
  langMenu.classList.add("hidden");
  copyMenu.classList.add("hidden");
  syncAppearanceUi();
  appearanceMenu.classList.remove("hidden");
  const anchor = $("#btn-appearance").getBoundingClientRect();
  appearanceMenu.style.top = `${anchor.bottom + 6}px`;
  appearanceMenu.style.left = `${Math.min(anchor.left, window.innerWidth - appearanceMenu.offsetWidth - 12)}px`;
});

$("#ap-theme").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest(".seg-btn") as HTMLElement | null;
  if (b?.dataset.value) {
    appearance.theme = b.dataset.value as Theme;
    applyAppearance();
  }
});

$("#ap-font").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest(".seg-btn") as HTMLElement | null;
  if (b?.dataset.value) {
    appearance.font = b.dataset.value as FontKind;
    applyAppearance();
  }
});

$("#ap-font-inc").addEventListener("click", () => bumpFontSize(1));
$("#ap-font-dec").addEventListener("click", () => bumpFontSize(-1));

$("#ap-width").addEventListener("input", (e) => {
  appearance.width = Number((e.target as HTMLInputElement).value);
  applyAppearance();
});

listen<api.Settings>("settings-changed", (e) => {
  // Keep toolbar language in sync when changed from the settings window.
  applyLang(e.payload.targetLang);
});

// ---------------------------------------------------------------- copy

type CopyAction = "src-md" | "tr-md" | "bi-md" | "plain" | "html" | "text-all";

function nonMetaSegments(): api.MdSegment[] {
  return (state.doc?.segments ?? []).filter((s) => s.kind !== "meta");
}

function buildTranslatedMd(): { md: string; missing: number } {
  let missing = 0;
  const parts = nonMetaSegments().map((s) => {
    if (s.kind !== "text") return s.source;
    const tr = state.translations.get(s.id);
    if (tr) return tr.md;
    if (s.source.trim()) missing++;
    return s.source;
  });
  return { md: parts.join("\n\n") + "\n", missing };
}

function buildBilingualMd(): string {
  return (
    nonMetaSegments()
      .map((s) => {
        const tr = s.kind === "text" ? state.translations.get(s.id) : undefined;
        return tr && tr.md.trim() !== s.source.trim() ? `${s.source}\n\n${tr.md}` : s.source;
      })
      .join("\n\n") + "\n"
  );
}

/// Snapshot of the article HTML matching what is currently visible.
function buildViewHtml(): string {
  const article = content.querySelector(".markdown-body");
  if (!article) return "";
  const clone = article.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".seg-err, .seg-tools").forEach((el) => el.remove());
  if (state.mode === "off") {
    clone.querySelectorAll(".seg-tr").forEach((el) => el.remove());
  } else if (state.mode === "replace") {
    clone.querySelectorAll(".seg:has(.seg-tr) .seg-src").forEach((el) => el.remove());
  }
  return clone.innerHTML;
}

function viewPlainText(): string {
  const el = (content.querySelector(".markdown-body") ??
    content.querySelector(".text-view")) as HTMLElement | null;
  return el?.innerText ?? "";
}

async function doCopy(action: CopyAction) {
  if (!state.path) return;
  try {
    switch (action) {
      case "src-md":
      case "text-all": {
        const t = await api.readTextFile(state.path);
        await writeText(t.content);
        showToast(action === "src-md" ? "已复制原文 Markdown" : "已复制全文");
        break;
      }
      case "tr-md": {
        const { md, missing } = buildTranslatedMd();
        await writeText(md);
        showToast(missing ? `已复制译文（${missing} 段未翻译，暂用原文）` : "已复制译文 Markdown");
        break;
      }
      case "bi-md":
        await writeText(buildBilingualMd());
        showToast("已复制双语 Markdown");
        break;
      case "plain":
        await writeText(viewPlainText());
        showToast("已复制纯文本");
        break;
      case "html":
        await writeHtml(buildViewHtml(), viewPlainText());
        showToast("已复制 HTML（富文本）");
        break;
    }
  } catch (e) {
    showToast(`复制失败：${e}`);
  }
}

function renderCopyMenu() {
  const hasTr = state.translations.size > 0;
  const items =
    state.kind === "markdown"
      ? [
          { a: "src-md", label: "原文 Markdown" },
          { a: "tr-md", label: "译文 Markdown", dim: !hasTr },
          { a: "bi-md", label: "双语 Markdown", dim: !hasTr },
          { a: "plain", label: "纯文本（当前视图）" },
          { a: "html", label: "HTML 富文本（当前视图）" },
        ]
      : [{ a: "text-all", label: "复制全文" }];
  copyMenu.innerHTML = items
    .map(
      (i) =>
        `<div class="menu-item${i.dim ? " dim" : ""}" data-copy="${i.a}">${i.label}</div>`,
    )
    .join("");
}

copyBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!copyMenu.classList.contains("hidden")) {
    copyMenu.classList.add("hidden");
    return;
  }
  langMenu.classList.add("hidden");
  renderCopyMenu();
  copyMenu.classList.remove("hidden");
  const anchor = copyBtn.getBoundingClientRect();
  copyMenu.style.top = `${anchor.bottom + 6}px`;
  copyMenu.style.left = `${Math.min(anchor.left, window.innerWidth - copyMenu.offsetWidth - 12)}px`;
});

copyMenu.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest(".menu-item") as HTMLElement | null;
  if (item?.dataset.copy) {
    copyMenu.classList.add("hidden");
    doCopy(item.dataset.copy as CopyAction);
  }
});

/// Hover copy buttons on each prose/code segment.
function injectSegTools() {
  content.querySelectorAll("section.seg").forEach((seg) => {
    const el = seg as HTMLElement;
    const kind = el.dataset.kind;
    if ((kind !== "text" && kind !== "code") || el.querySelector(".seg-tools")) return;
    const id = el.dataset.seg;
    const div = document.createElement("div");
    div.className = "seg-tools";
    div.innerHTML =
      `<button class="seg-copy" data-copy-src="${id}" title="复制此段原文">原</button>` +
      `<button class="seg-copy tr-only" data-copy-tr="${id}" title="复制此段译文">译</button>`;
    seg.appendChild(div);
  });
}

content.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const copySrc = target.closest("[data-copy-src]") as HTMLElement | null;
  if (copySrc) {
    const seg = state.doc?.segments[Number(copySrc.dataset.copySrc)];
    if (seg) writeText(seg.source).then(() => showToast("已复制该段原文"));
    return;
  }
  const copyTr = target.closest("[data-copy-tr]") as HTMLElement | null;
  if (copyTr) {
    const tr = state.translations.get(Number(copyTr.dataset.copyTr));
    if (tr) writeText(tr.md).then(() => showToast("已复制该段译文"));
    else showToast("该段尚未翻译");
    return;
  }
  const a = target.closest("a[data-retry]") as HTMLElement | null;
  if (a) {
    e.preventDefault();
    const id = Number(a.dataset.retry);
    state.failed.delete(id);
    segEl(id)?.querySelector(".seg-err")?.remove();
    startTranslate([id]);
    return;
  }
  const link = target.closest("a[href]") as HTMLAnchorElement | null;
  if (link) {
    e.preventDefault();
    handleLink(link.getAttribute("href") ?? "");
  }
});

// Block middle-click / modified-click navigation too.
content.addEventListener("auxclick", (e) => {
  if ((e.target as HTMLElement).closest("a[href]")) e.preventDefault();
});

/// Links never navigate the webview: anchors scroll in-document, external
/// URLs open in the system browser after an explicit confirmation, and
/// relative paths open in Preview after confirmation.
async function handleLink(href: string) {
  if (!href || href === "#") return;
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    const anchor =
      document.getElementById(id) ??
      content.querySelector(`[name="${CSS.escape(id)}"]`);
    anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  let url: URL | null = null;
  try {
    url = new URL(href);
  } catch {
    /* relative path */
  }
  if (url) {
    if (["http:", "https:", "mailto:"].includes(url.protocol)) {
      const ok = await confirm(href, {
        title: "在浏览器中打开链接？",
        kind: "info",
        okLabel: "打开",
        cancelLabel: "取消",
      });
      if (ok) await openUrl(href).catch((err) => showToast(`打开失败:${err}`));
    } else {
      showToast(`已阻止链接协议:${url.protocol}`);
    }
    return;
  }
  if (!state.path) return;
  const dir = state.path.slice(0, state.path.lastIndexOf("/") + 1);
  const rel = decodeURIComponent(href.split("#")[0].split("?")[0]);
  if (!rel) return;
  const resolved = dir + rel;
  const ok = await confirm(resolved, {
    title: "在 Preview 中打开该文件？",
    kind: "info",
    okLabel: "打开",
    cancelLabel: "取消",
  });
  if (ok) loadFile(resolved);
}

// ---------------------------------------------------------------- text

const EXT_LANG: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript",
  py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", kt: "kotlin",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", swift: "swift",
  sh: "bash", bash: "bash", zsh: "bash", json: "json", yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", css: "css", scss: "scss", sql: "sql", xml: "xml",
  php: "php", lua: "lua", diff: "diff", patch: "diff",
};

async function showText(info: api.FileInfo) {
  const doc = await api.readTextFile(info.path);
  content.innerHTML = `<div class="text-wrap"><div class="text-meta">${doc.encoding}${
    doc.truncated ? " · 文件过大，已截断" : ""
  }</div><pre class="text-view"><code></code></pre></div>`;
  const code = content.querySelector("code")!;
  code.textContent = doc.content;
  if (doc.content.length < 500_000) {
    const ext = info.name.split(".").pop()?.toLowerCase() ?? "";
    const lang = EXT_LANG[ext];
    if (lang && hljs.getLanguage(lang)) code.classList.add(`language-${lang}`);
    hljs.highlightElement(code as HTMLElement);
  }
}

// ---------------------------------------------------------------- image

function imgEl(): HTMLImageElement | null {
  return content.querySelector("#the-img");
}

function fitZoom(): number {
  const img = imgEl();
  if (!img || !img.naturalWidth) return 1;
  const rot = ((state.imgRot % 360) + 360) % 360;
  const [iw, ih] =
    rot % 180 === 0 ? [img.naturalWidth, img.naturalHeight] : [img.naturalHeight, img.naturalWidth];
  return Math.min((content.clientWidth - 48) / iw, (content.clientHeight - 48) / ih, 1);
}

function applyImgTransform() {
  const img = imgEl();
  if (!img || !img.naturalWidth) return;
  const zoom = state.imgFit ? fitZoom() : state.imgZoom;
  img.style.width = `${img.naturalWidth * zoom}px`;
  img.style.transform = `rotate(${state.imgRot}deg)`;
  zoomLabel.textContent = state.imgFit ? `适配 ${Math.round(zoom * 100)}%` : `${Math.round(zoom * 100)}%`;
}

function showImage(info: api.FileInfo) {
  state.imgZoom = 1;
  state.imgRot = 0;
  state.imgFit = true;
  content.innerHTML = `<div class="image-stage"><img id="the-img" alt="" /></div>`;
  const img = imgEl()!;
  img.onload = applyImgTransform;
  img.onerror = () => showMessage("图片加载失败", info.path);
  img.src = convertFileSrc(info.path);
}

function zoomBy(factor: number) {
  const base = state.imgFit ? fitZoom() : state.imgZoom;
  state.imgZoom = Math.min(16, Math.max(0.05, base * factor));
  state.imgFit = false;
  applyImgTransform();
}

$("#img-zoom-in").addEventListener("click", () => zoomBy(1.25));
$("#img-zoom-out").addEventListener("click", () => zoomBy(0.8));
$("#img-fit").addEventListener("click", () => {
  state.imgFit = true;
  applyImgTransform();
});
$("#img-orig").addEventListener("click", () => {
  state.imgFit = false;
  state.imgZoom = 1;
  applyImgTransform();
});
$("#img-rotate").addEventListener("click", () => {
  state.imgRot = (state.imgRot + 90) % 360;
  applyImgTransform();
});
window.addEventListener("resize", () => {
  if (state.kind === "image" && state.imgFit) applyImgTransform();
});

// ---------------------------------------------------------------- html

function showHtml(info: api.FileInfo) {
  content.innerHTML = `<div class="html-wrap"><div class="html-note">沙箱预览（脚本已禁用）</div><iframe class="html-frame" sandbox src="${convertFileSrc(
    info.path,
  )}"></iframe></div>`;
}

// ---------------------------------------------------------------- events

listen<api.TrProgress>("translate-progress", (e) => {
  const p = e.payload;
  if (p.docKey !== state.path) return;
  if (p.status === "done" && p.html !== null && p.md !== null) {
    state.translations.set(p.seg, { md: p.md, html: p.html });
    state.failed.delete(p.seg);
    upsertSegTranslation(p.seg, p.html);
  } else if (p.status === "error") {
    state.failed.set(p.seg, p.error ?? "未知错误");
    upsertSegError(p.seg, p.error ?? "未知错误");
  }
  updateTrStatus();
});

listen<api.TrDone>("translate-done", (e) => {
  const d = e.payload;
  if (d.docKey !== state.path || d.cancelled) return;
  if (d.failed > 0) showToast(`翻译完成：${d.ok} 成功（缓存 ${d.cached}），${d.failed} 失败`);
});

let reloadTimer: number | undefined;
listen<string>("file-changed", (e) => {
  if (e.payload !== state.path) return;
  clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => {
    if (state.path) loadFile(state.path, { keepScroll: true });
  }, 150);
});

listen("open-file", async () => {
  const paths = await api.takePendingOpen();
  if (paths.length) loadFile(paths[paths.length - 1]);
});

getCurrentWebview().onDragDropEvent((event) => {
  const t = event.payload.type;
  if (t === "enter" || t === "over") {
    content.classList.add("dragover");
  } else if (t === "leave") {
    content.classList.remove("dragover");
  } else if (t === "drop") {
    content.classList.remove("dragover");
    const paths = event.payload.paths;
    if (paths.length) loadFile(paths[0]);
  }
});

// ---------------------------------------------------------------- toolbar & keys

$("#btn-open").addEventListener("click", pickFile);
$("#btn-settings").addEventListener("click", () => api.openSettingsWindow());
document.addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === "empty-open") {
    e.preventDefault();
    pickFile();
  } else if (id === "empty-open-folder") {
    e.preventDefault();
    pickFolder();
  }
});

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.shiftKey && (e.key === "o" || e.key === "O")) {
    e.preventDefault();
    pickFolder();
  } else if (mod && e.key === "o") {
    e.preventDefault();
    pickFile();
  } else if (mod && e.key === "b") {
    e.preventDefault();
    toggleSidebar();
  } else if (mod && e.key === ",") {
    e.preventDefault();
    api.openSettingsWindow();
  } else if (mod && e.shiftKey && (e.key === "c" || e.key === "C")) {
    e.preventDefault();
    if (state.kind === "markdown") doCopy("src-md");
    else if (state.kind === "text") doCopy("text-all");
  } else if (mod && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    bumpFontSize(1);
  } else if (mod && e.key === "-") {
    e.preventDefault();
    bumpFontSize(-1);
  } else if (mod && e.key === "0") {
    e.preventDefault();
    appearance.fontSize = DEFAULT_APPEARANCE.fontSize;
    appearance.width = DEFAULT_APPEARANCE.width;
    applyAppearance();
  }
});

// ---------------------------------------------------------------- startup

(async () => {
  applyAppearance();
  try {
    const s = await api.getSettings();
    state.targetLang = s.targetLang || "简体中文";
  } catch {
    /* defaults are fine */
  }
  dstLangEl.textContent = `·${langLabel(state.targetLang)}`;
  const pending = await api.takePendingOpen().catch(() => [] as string[]);
  if (pending.length) loadFile(pending[pending.length - 1]);
})();
