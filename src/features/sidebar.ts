import * as api from "../api";
import { iconForKind } from "../formats";
import { basename, escapeHtml, query } from "../shared/dom";

interface SidebarOptions {
  openFile(path: string): void;
  requestFolder(): void;
  currentPath(): string | null;
  showToast(message: string): void;
}

export class SidebarController {
  private readonly sidebar = query<HTMLElement>("#sidebar");
  private readonly tree = query<HTMLElement>("#tree");
  private readonly rootLabel = query<HTMLElement>("#sb-root");
  private folder: string | null = null;
  private folderLoad = 0;

  constructor(private readonly options: SidebarOptions) {
    query("#btn-sidebar").addEventListener("click", () => this.toggle());
    query("#sb-close").addEventListener("click", () => this.sidebar.classList.add("hidden"));
    this.tree.addEventListener("click", (event) => void this.handleTreeClick(event));
    this.bindResize();
  }

  async openFolder(directory: string): Promise<void> {
    const load = ++this.folderLoad;
    try {
      const level = await this.buildLevel(directory);
      if (load !== this.folderLoad) return;
      this.folder = directory;
      this.rootLabel.textContent = basename(directory);
      this.rootLabel.title = directory;
      this.tree.replaceChildren(level);
      this.sidebar.classList.remove("hidden");
      const current = this.options.currentPath();
      if (current) this.markActive(current);
    } catch (error) {
      if (load === this.folderLoad) this.options.showToast(String(error));
    }
  }

  cancelPendingOpen(): void {
    this.folderLoad++;
  }

  markActive(path: string): void {
    this.tree.querySelectorAll(".tree-row.active").forEach((element) => {
      element.classList.remove("active");
    });
    this.tree.querySelectorAll<HTMLElement>(".tree-row").forEach((row) => {
      if (row.dataset.path === path) row.classList.add("active");
    });
  }

  toggle(): void {
    if (!this.folder) {
      this.options.requestFolder();
      return;
    }
    this.sidebar.classList.toggle("hidden");
  }

  private async buildLevel(directory: string): Promise<HTMLElement> {
    const entries = await api.listDir(directory);
    const list = document.createElement("ul");
    list.className = "tree-level";
    for (const entry of entries) {
      const item = document.createElement("li");
      item.className = "tree-node";
      const row = document.createElement("div");
      row.className = "tree-row";
      row.dataset.path = entry.path;
      if (entry.isDir) row.dataset.dir = "1";
      row.title = entry.name;
      row.innerHTML =
        `<span class="tw">${entry.isDir ? "▸" : ""}</span>` +
        `<span class="ti">${iconForKind(entry.kind)}</span>` +
        `<span class="tn">${escapeHtml(entry.name)}</span>`;
      item.appendChild(row);
      list.appendChild(item);
    }
    return list;
  }

  private async handleTreeClick(event: Event): Promise<void> {
    const row = (event.target as HTMLElement).closest<HTMLElement>(".tree-row");
    if (!row?.dataset.path) return;
    const item = row.parentElement as HTMLElement;
    if (!row.dataset.dir) {
      this.options.openFile(row.dataset.path);
      return;
    }

    const existing = item.querySelector<HTMLElement>(":scope > .tree-level");
    if (existing) {
      existing.classList.toggle("hidden");
      row.classList.toggle("open", !existing.classList.contains("hidden"));
      return;
    }

    row.classList.add("open");
    try {
      item.appendChild(await this.buildLevel(row.dataset.path));
    } catch (error) {
      row.classList.remove("open");
      this.options.showToast(String(error));
    }
  }

  private bindResize(): void {
    const resizer = query<HTMLElement>("#sb-resizer");
    const saved = Number(localStorage.getItem("preview-sbw"));
    if (saved >= 180 && saved <= 520) {
      document.documentElement.style.setProperty("--sb-w", `${saved}px`);
    }
    let dragging = false;
    resizer.addEventListener("mousedown", (event) => {
      dragging = true;
      event.preventDefault();
      document.body.style.cursor = "col-resize";
    });
    window.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      const width = Math.min(520, Math.max(180, event.clientX));
      document.documentElement.style.setProperty("--sb-w", `${width}px`);
    });
    window.addEventListener("mouseup", (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = "";
      const width = Math.min(520, Math.max(180, event.clientX));
      localStorage.setItem("preview-sbw", String(width));
    });
  }
}
