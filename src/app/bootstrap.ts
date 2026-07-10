import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import * as api from "../api";
import { FALLBACK_PICKER_EXTENSIONS, pickerExtensions } from "../formats";
import { AppearanceController } from "../features/appearance";
import { CopyController } from "../features/copy";
import { FindController } from "../features/find";
import { SidebarController } from "../features/sidebar";
import { query } from "../shared/dom";
import type { ViewerAppEvent } from "../viewers/contracts";
import { createViewerRegistry } from "../viewers/registry";
import { ViewerHost } from "./viewer-host";

export async function bootstrap(): Promise<void> {
  const content = query<HTMLElement>("#content");
  const viewerToolbar = query<HTMLElement>("#viewer-tools");
  const languageMenu = query<HTMLElement>("#lang-menu");
  const fileName = query<HTMLElement>("#file-name");
  const toast = query<HTMLElement>("#toast");
  let toastTimer: number | undefined;
  let targetLanguage = "简体中文";

  const showToast = (message: string) => {
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 4000);
  };

  const appearance = new AppearanceController();
  let host!: ViewerHost;
  const find = new FindController(content, () => host?.session() ?? null);
  const copy = new CopyController(() => host?.session() ?? null, showToast);

  const pickFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: "选择文件夹" });
    if (typeof picked === "string") await sidebar.openFolder(picked);
  };

  const sidebar = new SidebarController({
    openFile: (path) => void host.loadFile(path),
    requestFolder: () => void pickFolder(),
    currentPath: () => host?.currentFile()?.path ?? null,
    showToast,
  });

  host = new ViewerHost({
    content,
    toolbar: viewerToolbar,
    languageMenu,
    fileName,
    registry: createViewerRegistry(),
    getTheme: () => appearance.currentTheme(),
    getTargetLanguage: () => targetLanguage,
    setTargetLanguage: async (value, persist) => {
      targetLanguage = value;
      if (!persist) return;
      try {
        const settings = await api.getSettings();
        await api.saveSettings({ ...settings, targetLang: value });
      } catch {
        // Keep the session-local language when persistence fails.
      }
    },
    openFolder: (path) => sidebar.openFolder(path),
    showToast,
    onSessionChanged: (session) => {
      if (session) sidebar.cancelPendingOpen();
      copy.sync();
    },
    onFileReady: (file) => {
      sidebar.markActive(file.path);
      copy.sync();
      find.onViewerChanged();
    },
  });

  appearance.onThemeChanged(() => host.notifyAppearanceChanged());
  appearance.initialize();

  const catalogPromise = api.getFormatCatalog().catch(() => [] as api.FormatCatalogEntry[]);
  const pickFile = async () => {
    const catalog = await catalogPromise;
    const extensions = catalog.length > 0 ? pickerExtensions(catalog) : FALLBACK_PICKER_EXTENSIONS;
    const picked = await openDialog({
      multiple: false,
      title: "选择要预览的文件",
      filters: [
        { name: "支持的文件", extensions },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (typeof picked === "string") await host.loadFile(picked);
  };

  query("#btn-open").addEventListener("click", () => void pickFile());
  query("#btn-settings").addEventListener("click", () => void api.openSettingsWindow());
  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    document.querySelectorAll<HTMLElement>(".menu:not(.hidden)").forEach((menu) => {
      if (!menu.contains(target)) menu.classList.add("hidden");
    });
    const id = (event.target as HTMLElement).id;
    if (id === "empty-open") {
      event.preventDefault();
      void pickFile();
    } else if (id === "empty-open-folder") {
      event.preventDefault();
      void pickFolder();
    }
  });

  window.addEventListener("resize", () => host.notifyResize());
  window.addEventListener("keydown", (event) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.shiftKey && (event.key === "o" || event.key === "O")) {
      event.preventDefault();
      void pickFolder();
    } else if (modifier && event.key === "o") {
      event.preventDefault();
      void pickFile();
    } else if (modifier && event.key === "b") {
      event.preventDefault();
      sidebar.toggle();
    } else if (modifier && event.key === ",") {
      event.preventDefault();
      void api.openSettingsWindow();
    } else if (modifier && event.shiftKey && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      copy.runPrimary();
    } else if (modifier && (event.key === "=" || event.key === "+")) {
      event.preventDefault();
      appearance.bumpFontSize(1);
    } else if (modifier && event.key === "-") {
      event.preventDefault();
      appearance.bumpFontSize(-1);
    } else if (modifier && event.key === "0") {
      event.preventDefault();
      appearance.resetScale();
    } else if (modifier && (event.key === "f" || event.key === "F")) {
      event.preventDefault();
      find.open();
    } else if (modifier && (event.key === "g" || event.key === "G") && find.isOpen()) {
      event.preventDefault();
      find.navigate(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && find.isOpen()) {
      event.preventDefault();
      find.close();
    }
  });

  let reloadTimer: number | undefined;
  let settingsRevision = 0;
  let pendingReady = false;
  let pendingDrain = Promise.resolve();
  const initialSettings = api.getSettings().catch(() => null);
  const requestPendingDrain = () => {
    pendingDrain = pendingDrain.then(async () => {
      if (!pendingReady) return;
      const paths = await api.takePendingOpen().catch(() => [] as string[]);
      if (paths.length > 0) await host.loadFile(paths[paths.length - 1]);
    });
    return pendingDrain;
  };

  await Promise.all([
    listen<api.Settings>("settings-changed", (event) => {
      settingsRevision++;
      targetLanguage = event.payload.targetLang || "简体中文";
      const viewerEvent: ViewerAppEvent = { type: "settings-changed", payload: event.payload };
      host.dispatch(viewerEvent);
    }),
    listen<api.TrProgress>("translate-progress", (event) => {
      host.dispatch({ type: "translation-progress", payload: event.payload });
    }),
    listen<api.TrDone>("translate-done", (event) => {
      host.dispatch({ type: "translation-done", payload: event.payload });
    }),
    listen<string>("file-changed", (event) => {
      if (event.payload !== host.currentFile()?.path) return;
      clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => host.reloadCurrent(), 150);
    }),
    listen("open-file", () => {
      void requestPendingDrain();
    }),
    getCurrentWebview().onDragDropEvent((event) => {
      const type = event.payload.type;
      if (type === "enter" || type === "over") {
        content.classList.add("dragover");
      } else if (type === "leave") {
        content.classList.remove("dragover");
      } else if (type === "drop") {
        content.classList.remove("dragover");
        const paths = event.payload.paths;
        if (paths.length > 0) void host.loadFile(paths[0]);
      }
    }),
  ]);

  const settings = await initialSettings;
  if (settings && settingsRevision === 0) {
    targetLanguage = settings.targetLang || "简体中文";
    host.dispatch({ type: "settings-changed", payload: settings });
  }
  pendingReady = true;
  await requestPendingDrain();
}
