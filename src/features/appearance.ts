import { query } from "../shared/dom";

type Theme = "auto" | "light" | "dark";
type EffectiveTheme = "light" | "dark";
type FontKind = "system" | "serif" | "mono";

interface AppearanceState {
  theme: Theme;
  font: FontKind;
  fontSize: number;
  width: number;
}

const FONT_STACKS: Record<FontKind, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif CJK SC", serif',
  mono: '"SF Mono", ui-monospace, Menlo, Consolas, "PingFang SC", monospace',
};

const DEFAULT_APPEARANCE: AppearanceState = {
  theme: "auto",
  font: "system",
  fontSize: 15,
  width: 860,
};

export class AppearanceController {
  private readonly state = this.load();
  private readonly media = window.matchMedia("(prefers-color-scheme: dark)");
  private readonly listeners = new Set<(theme: EffectiveTheme) => void>();
  private readonly menu = query<HTMLElement>("#appearance-menu");
  private readonly button = query<HTMLElement>("#btn-appearance");

  constructor() {
    this.button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleMenu();
    });
    query("#ap-theme").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(".seg-btn");
      if (button?.dataset.value) {
        this.state.theme = button.dataset.value as Theme;
        this.apply();
      }
    });
    query("#ap-font").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(".seg-btn");
      if (button?.dataset.value) {
        this.state.font = button.dataset.value as FontKind;
        this.apply();
      }
    });
    query("#ap-font-inc").addEventListener("click", () => this.bumpFontSize(1));
    query("#ap-font-dec").addEventListener("click", () => this.bumpFontSize(-1));
    query<HTMLInputElement>("#ap-width").addEventListener("input", (event) => {
      this.state.width = Number((event.target as HTMLInputElement).value);
      this.apply();
    });
    this.media.addEventListener("change", () => {
      if (this.state.theme === "auto") this.apply();
    });
  }

  initialize(): void {
    this.apply();
  }

  currentTheme(): EffectiveTheme {
    return this.state.theme === "auto" ? (this.media.matches ? "dark" : "light") : this.state.theme;
  }

  onThemeChanged(listener: (theme: EffectiveTheme) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  bumpFontSize(delta: number): void {
    this.state.fontSize = Math.min(28, Math.max(11, this.state.fontSize + delta));
    this.apply();
  }

  resetScale(): void {
    this.state.fontSize = DEFAULT_APPEARANCE.fontSize;
    this.state.width = DEFAULT_APPEARANCE.width;
    this.apply();
  }

  closeMenu(): void {
    this.menu.classList.add("hidden");
  }

  private toggleMenu(): void {
    if (!this.menu.classList.contains("hidden")) {
      this.closeMenu();
      return;
    }
    document.querySelectorAll<HTMLElement>(".menu:not(.hidden)").forEach((menu) => {
      if (menu !== this.menu) menu.classList.add("hidden");
    });
    this.syncUi();
    this.menu.classList.remove("hidden");
    const anchor = this.button.getBoundingClientRect();
    this.menu.style.top = `${anchor.bottom + 6}px`;
    this.menu.style.left = `${Math.min(anchor.left, window.innerWidth - this.menu.offsetWidth - 12)}px`;
  }

  private apply(): void {
    const root = document.documentElement;
    const theme = this.currentTheme();
    const themeChanged = root.dataset.theme !== theme;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    root.style.setProperty("--md-width", this.state.width >= 1400 ? "100%" : `${this.state.width}px`);
    root.style.setProperty("--md-font-size", `${this.state.fontSize}px`);
    root.style.setProperty("--md-font", FONT_STACKS[this.state.font]);
    localStorage.setItem("preview-appearance", JSON.stringify(this.state));
    this.syncUi();
    if (themeChanged) this.listeners.forEach((listener) => listener(theme));
  }

  private syncUi(): void {
    this.menu.querySelectorAll<HTMLElement>("#ap-theme .seg-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.value === this.state.theme);
    });
    this.menu.querySelectorAll<HTMLElement>("#ap-font .seg-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.value === this.state.font);
    });
    query("#ap-font-val").textContent = String(this.state.fontSize);
    query<HTMLInputElement>("#ap-width").value = String(this.state.width);
    query("#ap-width-val").textContent = this.state.width >= 1400 ? "全宽" : String(this.state.width);
  }

  private load(): AppearanceState {
    try {
      return {
        ...DEFAULT_APPEARANCE,
        ...JSON.parse(localStorage.getItem("preview-appearance") ?? "{}"),
      } as AppearanceState;
    } catch {
      return { ...DEFAULT_APPEARANCE };
    }
  }
}
