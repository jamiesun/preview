import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import * as api from "../../api";
import { extensionOf } from "../../shared/dom";
import type { CopyAction, ViewerContext, ViewerFactory, ViewerSession } from "../contracts";
import type { TextDocument, TextModeRenderResult, TextRenderMode } from "./contracts";
import { textExtensionRegistry } from "./registry";

export class TextViewerFactory implements ViewerFactory {
  readonly kind = "text" as const;

  create(file: api.FileInfo, context: ViewerContext): ViewerSession {
    return new TextViewerSession(file, context);
  }
}

class TextViewerSession implements ViewerSession {
  private document: TextDocument | null = null;
  private modes: readonly TextRenderMode[] = [];
  private activeMode: TextRenderMode | null = null;
  private modeResult: TextModeRenderResult | null = null;
  private modeHost: HTMLElement | null = null;
  private modeRun = 0;

  constructor(
    readonly file: api.FileInfo,
    private readonly context: ViewerContext,
  ) {}

  async mount(): Promise<void> {
    this.context.toolbar.replaceChildren();
    const decoded = await api.readTextFile(this.file.path);
    if (!this.context.isCurrent()) return;

    const extension = extensionOf(this.file.name);
    const format = textExtensionRegistry.resolve(extension);
    this.document = {
      file: this.file,
      source: decoded.content,
      encoding: decoded.encoding,
      truncated: decoded.truncated,
      extension,
      formatId: format.id,
    };
    this.modes = textExtensionRegistry.modesFor(this.document);

    const wrap = document.createElement("div");
    wrap.className = "text-wrap";
    const meta = document.createElement("div");
    meta.className = "text-meta";
    meta.textContent = `${format.label} · ${decoded.encoding}${
      decoded.truncated ? " · 文件过大，已截断" : ""
    }`;
    this.modeHost = document.createElement("div");
    this.modeHost.className = "text-mode-host";
    wrap.append(meta, this.modeHost);
    this.context.content.replaceChildren(wrap);

    this.mountModeToolbar(format.id);
    const preferred = this.preferredMode(format.id);
    const initial = this.modes.find((mode) => mode.id === preferred) ?? this.modes[0];
    await this.activateMode(initial, false);
  }

  dispose(): void {
    this.modeRun++;
    this.modeResult?.dispose?.();
    this.modeResult = null;
  }

  getCopyActions(): readonly CopyAction[] {
    return [
      {
        id: "text-all",
        label: "复制全文",
        run: () => this.copySource(),
      },
    ];
  }

  copyPrimary(): Promise<void> {
    return this.copySource();
  }

  isFindElementHidden(): boolean {
    return false;
  }

  private mountModeToolbar(formatId: string): void {
    if (this.modes.length <= 1) {
      this.context.toolbar.replaceChildren();
      return;
    }
    const control = document.createElement("div");
    control.className = "seg-ctrl";
    control.dataset.textModes = formatId;
    for (const mode of this.modes) {
      const button = document.createElement("button");
      button.className = "seg-btn";
      button.dataset.mode = mode.id;
      button.textContent = mode.label;
      control.appendChild(button);
    }
    control.addEventListener(
      "click",
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
        const mode = this.modes.find((item) => item.id === button?.dataset.mode);
        if (mode) void this.activateMode(mode, true);
      },
      { signal: this.context.signal },
    );
    this.context.toolbar.replaceChildren(control);
  }

  private async activateMode(mode: TextRenderMode, savePreference: boolean): Promise<void> {
    if (!this.document || !this.modeHost) return;
    const run = ++this.modeRun;
    this.modeResult?.dispose?.();
    this.modeResult = null;
    this.activeMode = mode;
    this.syncModeToolbar();
    try {
      const result = await mode.render(this.document, {
        host: this.modeHost,
        signal: this.context.signal,
        isCurrent: () => this.context.isCurrent() && run === this.modeRun,
      });
      if (!this.context.isCurrent() || run !== this.modeRun) {
        result?.dispose?.();
        return;
      }
      this.modeResult = result ?? null;
      if (savePreference) {
        localStorage.setItem(`preview-text-mode:${this.document.formatId}`, mode.id);
      }
    } catch (error) {
      if (!this.context.isCurrent() || mode.id === "source") throw error;
      this.context.showToast(`${mode.label}渲染失败，已回退源码：${error}`);
      const source = this.modes.find((item) => item.id === "source");
      if (source) await this.activateMode(source, false);
    }
  }

  private syncModeToolbar(): void {
    this.context.toolbar.querySelectorAll<HTMLElement>("[data-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === this.activeMode?.id);
    });
  }

  private preferredMode(formatId: string): string {
    try {
      return localStorage.getItem(`preview-text-mode:${formatId}`) ?? "source";
    } catch {
      return "source";
    }
  }

  private async copySource(): Promise<void> {
    const decoded = await api.readTextFile(this.file.path);
    await writeText(decoded.content);
    this.context.showToast("已复制全文");
  }
}
