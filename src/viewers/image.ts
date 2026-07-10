import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileInfo } from "../api";
import type { ViewerContext, ViewerFactory, ViewerSession } from "./contracts";

export class ImageViewerFactory implements ViewerFactory {
  readonly kind = "image" as const;

  create(file: FileInfo, context: ViewerContext): ViewerSession {
    return new ImageViewerSession(file, context);
  }
}

class ImageViewerSession implements ViewerSession {
  private image: HTMLImageElement | null = null;
  private zoom = 1;
  private rotation = 0;
  private fit = true;
  private zoomLabel: HTMLElement | null = null;

  constructor(
    readonly file: FileInfo,
    private readonly context: ViewerContext,
  ) {}

  async mount(): Promise<void> {
    this.context.toolbar.innerHTML =
      '<button id="img-zoom-out" class="btn icon" title="缩小">−</button>' +
      '<span id="img-zoom-label" class="zoom-label">适配</span>' +
      '<button id="img-zoom-in" class="btn icon" title="放大">＋</button>' +
      '<button id="img-fit" class="btn" title="适配窗口">适配</button>' +
      '<button id="img-orig" class="btn" title="实际大小">1:1</button>' +
      '<button id="img-rotate" class="btn icon" title="旋转 90°">⟳</button>';
    this.zoomLabel = this.context.toolbar.querySelector("#img-zoom-label");

    const stage = document.createElement("div");
    stage.className = "image-stage";
    const image = document.createElement("img");
    image.alt = "";
    stage.appendChild(image);
    this.context.content.replaceChildren(stage);
    this.image = image;

    image.onload = () => {
      if (this.context.isCurrent() && this.image === image) this.applyTransform();
    };
    image.onerror = () => {
      if (this.context.isCurrent() && this.image === image) {
        this.context.showMessage("图片加载失败", this.file.path);
      }
    };
    image.src = convertFileSrc(this.file.path);

    this.bindToolbar();
  }

  dispose(): void {
    if (this.image) {
      this.image.onload = null;
      this.image.onerror = null;
    }
    this.image = null;
  }

  onResize(): void {
    if (this.fit) this.applyTransform();
  }

  isFindElementHidden(): boolean {
    return false;
  }

  private bindToolbar(): void {
    const listen = (selector: string, handler: () => void) => {
      this.context.toolbar.querySelector(selector)?.addEventListener("click", handler, {
        signal: this.context.signal,
      });
    };
    listen("#img-zoom-in", () => this.zoomBy(1.25));
    listen("#img-zoom-out", () => this.zoomBy(0.8));
    listen("#img-fit", () => {
      this.fit = true;
      this.applyTransform();
    });
    listen("#img-orig", () => {
      this.fit = false;
      this.zoom = 1;
      this.applyTransform();
    });
    listen("#img-rotate", () => {
      this.rotation = (this.rotation + 90) % 360;
      this.applyTransform();
    });
  }

  private fitZoom(): number {
    const image = this.image;
    if (!image?.naturalWidth) return 1;
    const rotation = ((this.rotation % 360) + 360) % 360;
    const [width, height] =
      rotation % 180 === 0
        ? [image.naturalWidth, image.naturalHeight]
        : [image.naturalHeight, image.naturalWidth];
    return Math.min(
      (this.context.content.clientWidth - 48) / width,
      (this.context.content.clientHeight - 48) / height,
      1,
    );
  }

  private applyTransform(): void {
    const image = this.image;
    if (!image?.naturalWidth) return;
    const zoom = this.fit ? this.fitZoom() : this.zoom;
    image.style.width = `${image.naturalWidth * zoom}px`;
    image.style.transform = `rotate(${this.rotation}deg)`;
    if (this.zoomLabel) {
      this.zoomLabel.textContent = this.fit
        ? `适配 ${Math.round(zoom * 100)}%`
        : `${Math.round(zoom * 100)}%`;
    }
  }

  private zoomBy(factor: number): void {
    const base = this.fit ? this.fitZoom() : this.zoom;
    this.zoom = Math.min(16, Math.max(0.05, base * factor));
    this.fit = false;
    this.applyTransform();
  }
}
