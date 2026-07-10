import type { FileInfo, Settings, TrDone, TrProgress } from "../api";

export type ViewerDisposeReason = "replace" | "reload" | "shutdown";

export type ViewerAppEvent =
  | { type: "translation-progress"; payload: TrProgress }
  | { type: "translation-done"; payload: TrDone }
  | { type: "settings-changed"; payload: Settings };

export interface CopyAction {
  id: string;
  label: string;
  dimmed?: boolean;
  run(): Promise<void>;
}

export interface ViewerContext {
  content: HTMLElement;
  toolbar: HTMLElement;
  languageMenu: HTMLElement;
  signal: AbortSignal;
  isCurrent(): boolean;
  showToast(message: string): void;
  showMessage(message: string, detail?: string): void;
  setTitle(title: string): void;
  openPath(path: string): Promise<void>;
  getTheme(): "light" | "dark";
  getTargetLanguage(): string;
  setTargetLanguage(value: string, persist: boolean): Promise<void>;
}

export interface ViewerSession {
  readonly file: FileInfo;
  mount(): Promise<void>;
  dispose(reason: ViewerDisposeReason): void | Promise<void>;
  getCopyActions?(): readonly CopyAction[];
  copyPrimary?(): Promise<void>;
  onResize?(): void;
  onAppearanceChanged?(): void;
  handleAppEvent?(event: ViewerAppEvent): void;
  isFindElementHidden?(element: Element): boolean;
}

export interface ViewerFactory {
  readonly kind: Exclude<FileInfo["kind"], "dir">;
  create(file: FileInfo, context: ViewerContext): ViewerSession;
}
