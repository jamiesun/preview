import { confirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import * as api from "../api";
import { escapeHtml } from "../shared/dom";
import { scheduleCodeHighlighting } from "../shared/highlight";
import { scheduleAfterPaint } from "../shared/schedule";
import type {
  CopyAction,
  ViewerAppEvent,
  ViewerContext,
  ViewerFactory,
  ViewerSession,
} from "./contracts";

type TranslationMode = "off" | "bilingual" | "replace";

interface MarkdownPreferences {
  mode: TranslationMode;
}

const LANGUAGES: { value: string; label: string }[] = [
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

let mermaidModule: typeof import("mermaid").default | null = null;
let mermaidSequence = 0;
let translationSequence = 0;
let translationCancellationBarrier: Promise<void> = Promise.resolve();

function queueTranslationCancellation(): Promise<void> {
  const next = translationCancellationBarrier.then(async () => {
    await api.cancelTranslate().catch(() => false);
  });
  translationCancellationBarrier = next;
  return next;
}

function nextTranslationRunId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${++translationSequence}`;
}

function languageLabel(value: string): string {
  return LANGUAGES.find((language) => language.value === value)?.label ?? value;
}

async function getMermaid(theme: "light" | "dark") {
  if (!mermaidModule) mermaidModule = (await import("mermaid")).default;
  mermaidModule.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
  });
  return mermaidModule;
}

async function renderMermaidIn(
  root: HTMLElement,
  theme: "light" | "dark",
  isCurrent: () => boolean,
): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre code.language-mermaid"));
  if (blocks.length === 0) return;
  const mermaid = await getMermaid(theme);
  for (const code of blocks) {
    if (!isCurrent()) return;
    const pre = code.closest("pre");
    if (!pre) continue;
    const source = code.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mmd-${++mermaidSequence}`, source);
      if (!isCurrent() || !pre.isConnected) continue;
      const figure = document.createElement("div");
      figure.className = "mermaid-fig";
      figure.dataset.src = source;
      figure.innerHTML = svg;
      pre.replaceWith(figure);
    } catch (error) {
      if (!isCurrent() || !pre.isConnected) continue;
      const message = document.createElement("div");
      message.className = "mermaid-err";
      message.textContent = `Mermaid 渲染失败：${String(error).split("\n")[0]}`;
      pre.before(message);
    }
  }
}

export class MarkdownViewerFactory implements ViewerFactory {
  readonly kind = "markdown" as const;
  private readonly preferences: MarkdownPreferences = { mode: "off" };

  create(file: api.FileInfo, context: ViewerContext): ViewerSession {
    return new MarkdownViewerSession(file, context, this.preferences);
  }
}

class MarkdownViewerSession implements ViewerSession {
  private document: api.MdDoc | null = null;
  private readonly translations = new Map<number, { md: string; html: string }>();
  private readonly failed = new Map<number, string>();
  private translating = false;
  private translationRun = 0;
  private activeRunId: string | null = null;
  private targetLanguage: string;
  private sourceLanguageElement: HTMLElement | null = null;
  private targetLanguageElement: HTMLElement | null = null;
  private statusElement: HTMLElement | null = null;
  private translationSwitch: HTMLElement | null = null;
  private cancelEnhancements: (() => void) | null = null;

  constructor(
    readonly file: api.FileInfo,
    private readonly context: ViewerContext,
    private readonly preferences: MarkdownPreferences,
  ) {
    this.targetLanguage = context.getTargetLanguage();
  }

  async mount(): Promise<void> {
    this.mountToolbar();
    this.bindToolbar();
    this.bindContentEvents();

    const cancellation = queueTranslationCancellation();
    const [markdown] = await Promise.all([api.renderMarkdown(this.file.path), cancellation]);
    if (!this.context.isCurrent()) return;
    this.translationRun++;
    this.activeRunId = null;
    this.translating = false;

    this.document = markdown;
    this.translations.clear();
    this.failed.clear();
    if (this.sourceLanguageElement) {
      this.sourceLanguageElement.textContent = markdown.detectedLang ? `·${markdown.detectedLang}` : "";
    }
    if (markdown.title) this.context.setTitle(markdown.title);

    const article = document.createElement("article");
    article.className = "markdown-body";
    article.dataset.trmode = this.preferences.mode;
    article.innerHTML = markdown.html;
    this.context.content.replaceChildren(article);
    const cancelHighlighting = scheduleCodeHighlighting(
      article,
      this.context.signal,
      () => this.context.isCurrent(),
    );
    const cancelToolsAndMermaid = scheduleAfterPaint(() => {
      if (!this.context.isCurrent() || !article.isConnected) return;
      this.injectSegmentTools();
      void renderMermaidIn(article, this.context.getTheme(), () => this.context.isCurrent());
      if (this.preferences.mode !== "off") void this.startTranslate();
    }, this.context.signal);
    this.cancelEnhancements = () => {
      cancelHighlighting();
      cancelToolsAndMermaid();
    };
    this.syncModeToolbar();
    this.updateTranslationStatus();
  }

  dispose(): void {
    this.translationRun++;
    this.activeRunId = null;
    this.cancelEnhancements?.();
    this.cancelEnhancements = null;
    this.closeLanguageMenu();
  }

  getCopyActions(): readonly CopyAction[] {
    const hasTranslations = this.translations.size > 0;
    return [
      { id: "src-md", label: "原文 Markdown", run: () => this.copy("src-md") },
      {
        id: "tr-md",
        label: "译文 Markdown",
        dimmed: !hasTranslations,
        run: () => this.copy("tr-md"),
      },
      {
        id: "bi-md",
        label: "双语 Markdown",
        dimmed: !hasTranslations,
        run: () => this.copy("bi-md"),
      },
      { id: "plain", label: "纯文本（当前视图）", run: () => this.copy("plain") },
      { id: "html", label: "HTML 富文本（当前视图）", run: () => this.copy("html") },
    ];
  }

  copyPrimary(): Promise<void> {
    return this.copy("src-md");
  }

  onAppearanceChanged(): void {
    void this.refreshMermaidTheme();
  }

  handleAppEvent(event: ViewerAppEvent): void {
    if (event.type === "translation-progress") {
      this.handleTranslationProgress(event.payload);
    } else if (event.type === "translation-done") {
      this.handleTranslationDone(event.payload);
    } else if (event.type === "settings-changed") {
      void this.applyLanguage(event.payload.targetLang, false);
    }
  }

  isFindElementHidden(element: Element): boolean {
    if (this.preferences.mode === "off" && element.classList.contains("seg-tr")) return true;
    return Boolean(
      this.preferences.mode === "replace" &&
        element.classList.contains("seg-src") &&
        element.parentElement?.querySelector(":scope > .seg-tr"),
    );
  }

  private mountToolbar(): void {
    this.context.toolbar.innerHTML =
      '<div class="seg-ctrl" id="tr-switch">' +
      '<button class="seg-btn" data-mode="off">原文<span class="seg-sub" id="src-lang"></span></button>' +
      '<button class="seg-btn" data-mode="replace">译文<span class="seg-sub" id="dst-lang"></span>' +
      '<span class="caret" id="lang-caret" title="选择目标语言">▾</span></button>' +
      '<button class="seg-btn" data-mode="bilingual">双语对照</button>' +
      "</div>" +
      '<span id="tr-status" class="tr-status"></span>';
    this.translationSwitch = this.context.toolbar.querySelector("#tr-switch");
    this.sourceLanguageElement = this.context.toolbar.querySelector("#src-lang");
    this.targetLanguageElement = this.context.toolbar.querySelector("#dst-lang");
    this.statusElement = this.context.toolbar.querySelector("#tr-status");
    if (this.targetLanguageElement) {
      this.targetLanguageElement.textContent = `·${languageLabel(this.targetLanguage)}`;
    }
    this.syncModeToolbar();
  }

  private bindToolbar(): void {
    this.translationSwitch?.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement;
        if (target.id === "lang-caret") return;
        const button = target.closest<HTMLElement>(".seg-btn");
        if (button?.dataset.mode) this.setMode(button.dataset.mode as TranslationMode);
      },
      { signal: this.context.signal },
    );

    this.context.toolbar.querySelector("#lang-caret")?.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
        if (!this.context.languageMenu.classList.contains("hidden")) {
          this.closeLanguageMenu();
          return;
        }
        this.renderLanguageMenu();
        const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
        this.context.languageMenu.style.top = `${anchor.bottom + 6}px`;
        this.context.languageMenu.style.left = `${Math.min(anchor.left - 60, window.innerWidth - 180)}px`;
        this.context.languageMenu.classList.remove("hidden");
      },
      { signal: this.context.signal },
    );

    this.context.languageMenu.addEventListener(
      "click",
      (event) => {
        const item = (event.target as HTMLElement).closest<HTMLElement>(".menu-item");
        if (!item?.dataset.lang) return;
        this.closeLanguageMenu();
        void this.applyLanguage(item.dataset.lang, true);
      },
      { signal: this.context.signal },
    );
  }

  private bindContentEvents(): void {
    this.context.content.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement;
        const copySource = target.closest<HTMLElement>("[data-copy-src]");
        if (copySource) {
          const id = Number(copySource.dataset.copySrc);
          const segment = this.document?.segments.find((item) => item.id === id);
          if (segment) void writeText(segment.source).then(() => this.context.showToast("已复制该段原文"));
          return;
        }
        const copyTranslation = target.closest<HTMLElement>("[data-copy-tr]");
        if (copyTranslation) {
          const translation = this.translations.get(Number(copyTranslation.dataset.copyTr));
          if (translation) {
            void writeText(translation.md).then(() => this.context.showToast("已复制该段译文"));
          } else {
            this.context.showToast("该段尚未翻译");
          }
          return;
        }
        const retry = target.closest<HTMLAnchorElement>("a[data-retry]");
        if (retry) {
          event.preventDefault();
          const id = Number(retry.dataset.retry);
          this.failed.delete(id);
          this.segmentElement(id)?.querySelector(".seg-err")?.remove();
          void this.startTranslate([id]);
          return;
        }
        const link = target.closest<HTMLAnchorElement>("a[href]");
        if (link) {
          event.preventDefault();
          void this.handleLink(link.getAttribute("href") ?? "");
        }
      },
      { signal: this.context.signal },
    );
    this.context.content.addEventListener(
      "auxclick",
      (event) => {
        if ((event.target as HTMLElement).closest("a[href]")) event.preventDefault();
      },
      { signal: this.context.signal },
    );
  }

  private setMode(mode: TranslationMode): void {
    this.preferences.mode = mode;
    this.syncModeToolbar();
    this.applyMode();
    this.updateTranslationStatus();
    if (mode !== "off") void this.startTranslate();
  }

  private syncModeToolbar(): void {
    this.translationSwitch?.querySelectorAll<HTMLElement>(".seg-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === this.preferences.mode);
    });
  }

  private applyMode(): void {
    const article = this.context.content.querySelector<HTMLElement>(".markdown-body");
    if (article) article.dataset.trmode = this.preferences.mode;
  }

  private renderLanguageMenu(): void {
    this.context.languageMenu.innerHTML = LANGUAGES.map(
      (language) =>
        `<div class="menu-item${language.value === this.targetLanguage ? " checked" : ""}" data-lang="${language.value}">` +
        `${language.label}<span class="menu-sub">${language.value}</span></div>`,
    ).join("");
  }

  private closeLanguageMenu(): void {
    this.context.languageMenu.classList.add("hidden");
  }

  private async applyLanguage(value: string, persist: boolean): Promise<void> {
    if (value === this.targetLanguage || !this.context.isCurrent()) return;
    this.targetLanguage = value;
    if (this.targetLanguageElement) {
      this.targetLanguageElement.textContent = `·${languageLabel(value)}`;
    }
    void this.context.setTargetLanguage(value, persist);
    const previousRunId = this.activeRunId;
    this.activeRunId = null;
    this.translationRun++;
    this.translating = false;
    if (previousRunId) await api.cancelTranslate(previousRunId).catch(() => false);
    if (!this.context.isCurrent()) return;
    this.clearTranslations();
    this.updateTranslationStatus();
    if (this.preferences.mode !== "off") void this.startTranslate();
  }

  private translatableSegments(): api.MdSegment[] {
    return (this.document?.segments ?? []).filter(
      (segment) => segment.kind === "text" && segment.source.trim().length > 0,
    );
  }

  private async startTranslate(onlyIds?: number[]): Promise<void> {
    if (!this.document || this.translating || !this.context.isCurrent()) return;
    const segments = this.translatableSegments().filter(
      (segment) =>
        !this.translations.has(segment.id) && (!onlyIds || onlyIds.includes(segment.id)),
    );
    if (segments.length === 0) {
      this.updateTranslationStatus();
      return;
    }
    const run = ++this.translationRun;
    const runId = nextTranslationRunId();
    this.activeRunId = runId;
    this.translating = true;
    this.updateTranslationStatus();
    try {
      await api.translateDoc(
        this.file.path,
        runId,
        segments.map((segment) => ({ id: segment.id, source: segment.source })),
        this.document.refdefs,
        this.targetLanguage,
      );
    } catch (error) {
      if (this.context.isCurrent()) this.context.showToast(String(error));
    } finally {
      if (run === this.translationRun && this.context.isCurrent()) {
        this.translating = false;
        this.updateTranslationStatus();
      }
    }
  }

  private updateTranslationStatus(): void {
    if (!this.statusElement) return;
    if (this.preferences.mode === "off") {
      this.statusElement.textContent = "";
      return;
    }
    const total = this.translatableSegments().length;
    const done = this.translations.size;
    const failed = this.failed.size;
    let text = `${done}/${total}`;
    if (failed > 0) text += ` · ${failed} 失败`;
    this.statusElement.textContent = this.translating ? `翻译中 ${text}` : text;
  }

  private handleTranslationProgress(progress: api.TrProgress): void {
    if (progress.docKey !== this.file.path || progress.runId !== this.activeRunId) return;
    if (progress.status === "done" && progress.html !== null && progress.md !== null) {
      this.translations.set(progress.seg, { md: progress.md, html: progress.html });
      this.failed.delete(progress.seg);
      this.upsertTranslation(progress.seg, progress.html);
    } else if (progress.status === "error") {
      const error = progress.error ?? "未知错误";
      this.failed.set(progress.seg, error);
      this.upsertError(progress.seg, error);
    }
    this.updateTranslationStatus();
  }

  private handleTranslationDone(done: api.TrDone): void {
    if (done.docKey !== this.file.path || done.runId !== this.activeRunId || done.cancelled) return;
    this.translating = false;
    this.updateTranslationStatus();
    if (done.failed > 0) {
      this.context.showToast(`翻译完成：${done.ok} 成功（缓存 ${done.cached}），${done.failed} 失败`);
    }
  }

  private segmentElement(id: number): HTMLElement | null {
    return this.context.content.querySelector(`section.seg[data-seg="${id}"]`);
  }

  private upsertTranslation(id: number, html: string): void {
    const segment = this.segmentElement(id);
    if (!segment) return;
    segment.querySelector(".seg-tr")?.remove();
    segment.querySelector(".seg-err")?.remove();
    const translation = document.createElement("div");
    translation.className = "seg-tr";
    translation.innerHTML = html;
    segment.appendChild(translation);
    scheduleCodeHighlighting(translation, this.context.signal, () => this.context.isCurrent());
    scheduleAfterPaint(() => {
      if (translation.isConnected) {
        void renderMermaidIn(translation, this.context.getTheme(), () => this.context.isCurrent());
      }
    }, this.context.signal);
  }

  private upsertError(id: number, error: string): void {
    const segment = this.segmentElement(id);
    if (!segment) return;
    segment.querySelector(".seg-err")?.remove();
    const message = document.createElement("div");
    message.className = "seg-err";
    message.innerHTML = `<span>翻译失败：${escapeHtml(error)}</span> <a href="#" data-retry="${id}">重试</a>`;
    segment.appendChild(message);
  }

  private clearTranslations(): void {
    this.context.content.querySelectorAll(".seg-tr, .seg-err").forEach((element) => element.remove());
    this.translations.clear();
    this.failed.clear();
  }

  private injectSegmentTools(): void {
    this.context.content.querySelectorAll<HTMLElement>("section.seg").forEach((segment) => {
      const kind = segment.dataset.kind;
      if ((kind !== "text" && kind !== "code") || segment.querySelector(".seg-tools")) return;
      const id = segment.dataset.seg;
      const tools = document.createElement("div");
      tools.className = "seg-tools";
      tools.innerHTML =
        `<button class="seg-copy" data-copy-src="${id}" title="复制此段原文">原</button>` +
        `<button class="seg-copy tr-only" data-copy-tr="${id}" title="复制此段译文">译</button>`;
      segment.appendChild(tools);
    });
  }

  private nonMetadataSegments(): api.MdSegment[] {
    return (this.document?.segments ?? []).filter((segment) => segment.kind !== "meta");
  }

  private buildTranslatedMarkdown(): { markdown: string; missing: number } {
    let missing = 0;
    const parts = this.nonMetadataSegments().map((segment) => {
      if (segment.kind !== "text") return segment.source;
      const translation = this.translations.get(segment.id);
      if (translation) return translation.md;
      if (segment.source.trim()) missing++;
      return segment.source;
    });
    return { markdown: `${parts.join("\n\n")}\n`, missing };
  }

  private buildBilingualMarkdown(): string {
    return `${this.nonMetadataSegments()
      .map((segment) => {
        const translation = segment.kind === "text" ? this.translations.get(segment.id) : undefined;
        return translation && translation.md.trim() !== segment.source.trim()
          ? `${segment.source}\n\n${translation.md}`
          : segment.source;
      })
      .join("\n\n")}\n`;
  }

  private buildViewHtml(): string {
    const article = this.context.content.querySelector(".markdown-body");
    if (!article) return "";
    const clone = article.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".seg-err, .seg-tools").forEach((element) => element.remove());
    if (this.preferences.mode === "off") {
      clone.querySelectorAll(".seg-tr").forEach((element) => element.remove());
    } else if (this.preferences.mode === "replace") {
      clone.querySelectorAll(".seg:has(.seg-tr) .seg-src").forEach((element) => element.remove());
    }
    return clone.innerHTML;
  }

  private viewPlainText(): string {
    return this.context.content.querySelector<HTMLElement>(".markdown-body")?.innerText ?? "";
  }

  private async copy(action: "src-md" | "tr-md" | "bi-md" | "plain" | "html"): Promise<void> {
    try {
      if (action === "src-md") {
        const source = await api.readTextFile(this.file.path);
        await writeText(source.content);
        this.context.showToast("已复制原文 Markdown");
      } else if (action === "tr-md") {
        const { markdown, missing } = this.buildTranslatedMarkdown();
        await writeText(markdown);
        this.context.showToast(
          missing ? `已复制译文（${missing} 段未翻译，暂用原文）` : "已复制译文 Markdown",
        );
      } else if (action === "bi-md") {
        await writeText(this.buildBilingualMarkdown());
        this.context.showToast("已复制双语 Markdown");
      } else if (action === "plain") {
        await writeText(this.viewPlainText());
        this.context.showToast("已复制纯文本");
      } else {
        await writeHtml(this.buildViewHtml(), this.viewPlainText());
        this.context.showToast("已复制 HTML（富文本）");
      }
    } catch (error) {
      this.context.showToast(`复制失败：${error}`);
    }
  }

  private async refreshMermaidTheme(): Promise<void> {
    if (!mermaidModule || !this.context.isCurrent()) return;
    mermaidModule.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: this.context.getTheme() === "dark" ? "dark" : "default",
    });
    for (const figure of Array.from(this.context.content.querySelectorAll<HTMLElement>(".mermaid-fig"))) {
      const source = figure.dataset.src ?? "";
      try {
        const { svg } = await mermaidModule.render(`mmd-${++mermaidSequence}`, source);
        if (this.context.isCurrent() && figure.isConnected) figure.innerHTML = svg;
      } catch {
        // Keep the previous rendering when a theme refresh fails.
      }
    }
  }

  private async handleLink(href: string): Promise<void> {
    if (!href || href === "#") return;
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      const anchor =
        document.getElementById(id) ??
        this.context.content.querySelector(`[name="${CSS.escape(id)}"]`);
      anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    let url: URL | null = null;
    try {
      url = new URL(href);
    } catch {
      // Relative file path.
    }
    if (url) {
      if (["http:", "https:", "mailto:"].includes(url.protocol)) {
        const accepted = await confirm(href, {
          title: "在浏览器中打开链接？",
          kind: "info",
          okLabel: "打开",
          cancelLabel: "取消",
        });
        if (accepted) await openUrl(href).catch((error) => this.context.showToast(`打开失败:${error}`));
      } else {
        this.context.showToast(`已阻止链接协议:${url.protocol}`);
      }
      return;
    }

    const directory = this.file.path.slice(0, this.file.path.lastIndexOf("/") + 1);
    const relative = decodeURIComponent(href.split("#")[0].split("?")[0]);
    if (!relative) return;
    const resolved = directory + relative;
    const accepted = await confirm(resolved, {
      title: "在 Preview 中打开该文件？",
      kind: "info",
      okLabel: "打开",
      cancelLabel: "取消",
    });
    if (accepted) await this.context.openPath(resolved);
  }
}
