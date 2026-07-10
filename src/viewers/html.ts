import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileInfo } from "../api";
import type { ViewerContext, ViewerFactory, ViewerSession } from "./contracts";

export class HtmlViewerFactory implements ViewerFactory {
  readonly kind = "html" as const;

  create(file: FileInfo, context: ViewerContext): ViewerSession {
    return new HtmlViewerSession(file, context);
  }
}

class HtmlViewerSession implements ViewerSession {
  constructor(
    readonly file: FileInfo,
    private readonly context: ViewerContext,
  ) {}

  async mount(): Promise<void> {
    this.context.toolbar.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "html-wrap";
    const note = document.createElement("div");
    note.className = "html-note";
    note.textContent = "沙箱预览（脚本已禁用）";
    const frame = document.createElement("iframe");
    frame.className = "html-frame";
    frame.setAttribute("sandbox", "");
    frame.src = convertFileSrc(this.file.path);
    wrap.append(note, frame);
    this.context.content.replaceChildren(wrap);
  }

  dispose(): void {}

  isFindElementHidden(): boolean {
    return false;
  }
}
