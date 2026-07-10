import type { FileInfo } from "../api";
import { HtmlViewerFactory } from "./html";
import { ImageViewerFactory } from "./image";
import { MarkdownViewerFactory } from "./markdown";
import { MessageViewerFactory } from "./message";
import { TextViewerFactory } from "./text/viewer";
import type { ViewerContext, ViewerFactory, ViewerSession } from "./contracts";

type ViewableKind = Exclude<FileInfo["kind"], "dir">;

export class ViewerRegistry {
  private readonly factories = new Map<ViewableKind, ViewerFactory>();

  register(factory: ViewerFactory): this {
    if (this.factories.has(factory.kind)) {
      throw new Error(`重复的 Viewer: ${factory.kind}`);
    }
    this.factories.set(factory.kind, factory);
    return this;
  }

  create(file: FileInfo, context: ViewerContext): ViewerSession {
    if (file.kind === "dir") throw new Error("文件夹不能创建 Viewer");
    const factory = this.factories.get(file.kind);
    if (!factory) throw new Error(`未注册 Viewer: ${file.kind}`);
    return factory.create(file, context);
  }
}

export function createViewerRegistry(): ViewerRegistry {
  return new ViewerRegistry()
    .register(new MarkdownViewerFactory())
    .register(new TextViewerFactory())
    .register(new ImageViewerFactory())
    .register(new HtmlViewerFactory())
    .register(
      new MessageViewerFactory(
        "pdf",
        "PDF 预览将在后续版本支持",
        () => "见 ROADMAP.md · PDF 渲染与文本层",
      ),
    )
    .register(new MessageViewerFactory("unknown", "暂不支持该文件类型", (file) => file.name));
}
