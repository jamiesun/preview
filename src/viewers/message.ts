import type { FileInfo } from "../api";
import type { ViewerContext, ViewerFactory, ViewerSession } from "./contracts";

export class MessageViewerFactory implements ViewerFactory {
  constructor(
    readonly kind: "pdf" | "unknown",
    private readonly message: string,
    private readonly detail: (file: FileInfo) => string,
  ) {}

  create(file: FileInfo, context: ViewerContext): ViewerSession {
    return new MessageViewerSession(file, context, this.message, this.detail(file));
  }
}

class MessageViewerSession implements ViewerSession {
  constructor(
    readonly file: FileInfo,
    private readonly context: ViewerContext,
    private readonly message: string,
    private readonly detail: string,
  ) {}

  async mount(): Promise<void> {
    this.context.toolbar.replaceChildren();
    this.context.showMessage(this.message, this.detail);
  }

  dispose(): void {}

  isFindElementHidden(): boolean {
    return false;
  }
}
