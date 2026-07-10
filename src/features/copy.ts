import { query } from "../shared/dom";
import type { CopyAction, ViewerSession } from "../viewers/contracts";

export class CopyController {
  private readonly button = query<HTMLElement>("#btn-copy");
  private readonly menu = query<HTMLElement>("#copy-menu");

  constructor(
    private readonly getSession: () => ViewerSession | null,
    private readonly showError: (message: string) => void,
  ) {
    this.button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleMenu();
    });
    this.menu.addEventListener("click", (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[data-copy]");
      if (!item?.dataset.copy) return;
      const action = this.actions().find((candidate) => candidate.id === item.dataset.copy);
      this.closeMenu();
      if (action) this.run(action.run);
    });
  }

  sync(): void {
    this.closeMenu();
    this.button.classList.toggle("hidden", this.actions().length === 0);
  }

  runPrimary(): void {
    const session = this.getSession();
    if (session?.copyPrimary) this.run(() => session.copyPrimary!());
  }

  closeMenu(): void {
    this.menu.classList.add("hidden");
  }

  private actions(): readonly CopyAction[] {
    return this.getSession()?.getCopyActions?.() ?? [];
  }

  private run(action: () => Promise<void>): void {
    void action().catch((error) => this.showError(`复制失败：${error}`));
  }

  private toggleMenu(): void {
    if (!this.menu.classList.contains("hidden")) {
      this.closeMenu();
      return;
    }
    const actions = this.actions();
    if (actions.length === 0) return;
    document.querySelectorAll<HTMLElement>(".menu:not(.hidden)").forEach((menu) => {
      if (menu !== this.menu) menu.classList.add("hidden");
    });
    this.menu.innerHTML = actions
      .map(
        (action) =>
          `<div class="menu-item${action.dimmed ? " dim" : ""}" data-copy="${action.id}">${action.label}</div>`,
      )
      .join("");
    this.menu.classList.remove("hidden");
    const anchor = this.button.getBoundingClientRect();
    this.menu.style.top = `${anchor.bottom + 6}px`;
    this.menu.style.left = `${Math.min(anchor.left, window.innerWidth - this.menu.offsetWidth - 12)}px`;
  }
}
