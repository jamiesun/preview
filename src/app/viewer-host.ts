import * as api from "../api";
import { escapeHtml } from "../shared/dom";
import type { ViewerAppEvent, ViewerContext, ViewerSession } from "../viewers/contracts";
import { ViewerRegistry } from "../viewers/registry";

interface LoadOptions {
  keepScroll?: boolean;
}

interface ViewerHostOptions {
  content: HTMLElement;
  toolbar: HTMLElement;
  languageMenu: HTMLElement;
  fileName: HTMLElement;
  registry: ViewerRegistry;
  getTheme(): "light" | "dark";
  getTargetLanguage(): string;
  setTargetLanguage(value: string, persist: boolean): Promise<void>;
  openFolder(path: string): Promise<void>;
  showToast(message: string): void;
  onSessionChanged(session: ViewerSession | null): void;
  onFileReady(file: api.FileInfo): void;
}

export class ViewerHost {
  private activeSession: ViewerSession | null = null;
  private activeController: AbortController | null = null;
  private pendingController: AbortController | null = null;
  private current: api.FileInfo | null = null;
  private navigation = 0;

  constructor(private readonly options: ViewerHostOptions) {}

  currentFile(): api.FileInfo | null {
    return this.current;
  }

  session(): ViewerSession | null {
    return this.activeSession;
  }

  async loadFile(path: string, loadOptions: LoadOptions = {}): Promise<void> {
    const navigation = ++this.navigation;
    this.pendingController?.abort();
    const controller = new AbortController();
    this.pendingController = controller;
    const previousScroll = loadOptions.keepScroll ? this.options.content.scrollTop : 0;

    try {
      const file = await api.detectFile(path);
      if (!this.isNavigationCurrent(navigation, controller)) return;
      if (file.kind === "dir") {
        this.pendingController = null;
        await this.options.openFolder(file.path);
        return;
      }

      const reason = loadOptions.keepScroll && this.current?.path === file.path ? "reload" : "replace";
      const previousSession = this.activeSession;
      const previousController = this.activeController;
      this.activeSession = null;
      this.activeController = null;
      this.options.onSessionChanged(null);
      previousController?.abort();
      if (previousSession) await previousSession.dispose(reason);
      if (!this.isNavigationCurrent(navigation, controller)) return;
      this.options.toolbar.replaceChildren();
      this.options.languageMenu.classList.add("hidden");

      this.current = file;
      this.options.fileName.textContent = file.name;
      this.options.fileName.title = file.path;
      document.title = `${file.name} — Preview`;

      let session: ViewerSession;
      const context: ViewerContext = {
        content: this.options.content,
        toolbar: this.options.toolbar,
        languageMenu: this.options.languageMenu,
        signal: controller.signal,
        isCurrent: () =>
          this.isNavigationCurrent(navigation, controller) && this.activeSession === session,
        showToast: (message) => this.options.showToast(message),
        showMessage: (message, detail = "") => {
          if (this.isNavigationCurrent(navigation, controller)) this.showMessage(message, detail);
        },
        setTitle: (title) => {
          if (this.isNavigationCurrent(navigation, controller)) document.title = `${title} — Preview`;
        },
        openPath: (nextPath) => this.loadFile(nextPath),
        getTheme: () => this.options.getTheme(),
        getTargetLanguage: () => this.options.getTargetLanguage(),
        setTargetLanguage: (value, persist) => this.options.setTargetLanguage(value, persist),
      };
      session = this.options.registry.create(file, context);
      this.activeSession = session;
      this.activeController = controller;
      this.options.onSessionChanged(session);

      await session.mount();
      if (!context.isCurrent()) return;
      this.pendingController = null;
      if (loadOptions.keepScroll) this.options.content.scrollTop = previousScroll;
      void api.watchFile(file.path).catch(() => {});
      this.options.onFileReady(file);
    } catch (error) {
      if (!this.isNavigationCurrent(navigation, controller)) return;
      this.pendingController = null;
      controller.abort();
      const failedSession = this.activeSession;
      const failedController = this.activeController;
      this.activeSession = null;
      this.activeController = null;
      failedController?.abort();
      if (failedSession) {
        await Promise.resolve(failedSession.dispose("replace")).catch(() => {});
      }
      this.current = null;
      this.options.fileName.textContent = "";
      this.options.fileName.title = "";
      document.title = "Preview";
      this.options.toolbar.replaceChildren();
      this.options.languageMenu.classList.add("hidden");
      this.options.onSessionChanged(null);
      void api.unwatchFile().catch(() => {});
      this.showMessage(String(error));
    }
  }

  reloadCurrent(): void {
    if (this.current) void this.loadFile(this.current.path, { keepScroll: true });
  }

  dispatch(event: ViewerAppEvent): void {
    this.activeSession?.handleAppEvent?.(event);
  }

  notifyAppearanceChanged(): void {
    this.activeSession?.onAppearanceChanged?.();
  }

  notifyResize(): void {
    this.activeSession?.onResize?.();
  }

  private isNavigationCurrent(navigation: number, controller: AbortController): boolean {
    return navigation === this.navigation && !controller.signal.aborted;
  }

  private showMessage(message: string, detail = ""): void {
    this.options.content.innerHTML =
      '<div class="empty"><div class="empty-icon">⚠︎</div>' +
      `<p>${escapeHtml(message)}</p>` +
      (detail ? `<p class="hint">${escapeHtml(detail)}</p>` : "") +
      "</div>";
  }
}
