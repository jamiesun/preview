import { query } from "../shared/dom";
import type { ViewerSession } from "../viewers/contracts";

const FIND_MAX = 2000;
const FIND_BLOCKS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DETAILS", "DIV",
  "DL", "DT", "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6",
  "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "SUMMARY",
  "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

interface FindSpan {
  start: number;
  end: number;
  node: Text;
}

export class FindController {
  private readonly bar = query<HTMLElement>("#find-bar");
  private readonly input = query<HTMLInputElement>("#find-input");
  private readonly count = query<HTMLElement>("#find-count");
  private readonly caseButton = query<HTMLElement>("#find-case");
  private openState = false;
  private queryText = "";
  private matchCase = false;
  private ranges: Range[] = [];
  private current = -1;
  private inputTimer: number | undefined;
  private mutationTimer: number | undefined;
  private readonly observer: MutationObserver;

  constructor(
    private readonly content: HTMLElement,
    private readonly getSession: () => ViewerSession | null,
  ) {
    this.observer = new MutationObserver(() => {
      if (!this.openState || !this.queryText) return;
      clearTimeout(this.mutationTimer);
      this.mutationTimer = window.setTimeout(() => this.run(false, false), 200);
    });

    this.input.addEventListener("input", () => {
      clearTimeout(this.inputTimer);
      this.inputTimer = window.setTimeout(() => this.run(true, true), 120);
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.navigate(event.shiftKey ? -1 : 1);
      }
    });
    query("#find-next").addEventListener("click", () => this.navigate(1));
    query("#find-prev").addEventListener("click", () => this.navigate(-1));
    query("#find-close").addEventListener("click", () => this.close());
    this.caseButton.addEventListener("click", () => {
      this.matchCase = !this.matchCase;
      this.caseButton.classList.toggle("active", this.matchCase);
      this.input.focus();
      if (this.queryText || this.input.value) this.run(true, true);
    });
  }

  isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    const selectedText = window.getSelection()?.toString() ?? "";
    this.bar.classList.remove("hidden");
    if (!this.openState) {
      this.openState = true;
      this.observer.observe(this.content, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["data-trmode"],
      });
    }
    if (selectedText && !selectedText.includes("\n")) this.input.value = selectedText;
    this.input.focus();
    this.input.select();
    if (this.input.value) this.run(true, true);
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.bar.classList.add("hidden");
    this.observer.disconnect();
    clearTimeout(this.inputTimer);
    clearTimeout(this.mutationTimer);
    this.ranges = [];
    this.current = -1;
    this.clearHighlights();
    this.input.blur();
  }

  navigate(direction: 1 | -1): void {
    if (this.ranges.length === 0) return;
    this.current = (this.current + direction + this.ranges.length) % this.ranges.length;
    this.applyHighlights();
    this.updateCount();
    this.revealCurrent();
  }

  onViewerChanged(): void {
    this.ranges = [];
    this.current = -1;
    this.clearHighlights();
    if (this.openState && this.input.value) this.run(true, false);
  }

  private collectFindable(): { haystack: string; spans: FindSpan[] } {
    const parts: string[] = [];
    const spans: FindSpan[] = [];
    const session = this.getSession();
    let length = 0;
    const walker = document.createTreeWalker(
      this.content,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (element.matches("svg, .seg-tools, .seg-err")) return NodeFilter.FILTER_REJECT;
            if (element.classList.contains("hidden")) return NodeFilter.FILTER_REJECT;
            if (session?.isFindElementHidden?.(element)) return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (FIND_BLOCKS.has((node as Element).tagName)) {
          parts.push("\u0000");
          length++;
        }
        continue;
      }
      const text = node as Text;
      if (!text.data) continue;
      parts.push(text.data.replace(/\s/g, " "));
      spans.push({ start: length, end: length + text.data.length, node: text });
      length += text.data.length;
    }
    return { haystack: parts.join(""), spans };
  }

  private run(resetCurrent: boolean, reveal: boolean): void {
    this.queryText = this.input.value;
    this.ranges = [];
    if (!this.queryText) {
      this.current = -1;
      this.clearHighlights();
      this.updateCount();
      return;
    }

    const { haystack, spans } = this.collectFindable();
    const comparableHaystack = this.matchCase ? haystack : haystack.toLowerCase();
    const needle = (this.matchCase ? this.queryText : this.queryText.toLowerCase()).replace(/\s/g, " ");
    let index = 0;
    let spanIndex = 0;
    while (
      this.ranges.length < FIND_MAX &&
      (index = comparableHaystack.indexOf(needle, index)) !== -1
    ) {
      const end = index + needle.length;
      while (spanIndex < spans.length && spans[spanIndex].end <= index) spanIndex++;
      const startSpan = spans[spanIndex];
      let endIndex = spanIndex;
      while (endIndex < spans.length && spans[endIndex].end < end) endIndex++;
      const endSpan = spans[endIndex];
      if (startSpan && endSpan && startSpan.start <= index && endSpan.start < end) {
        const range = document.createRange();
        range.setStart(startSpan.node, index - startSpan.start);
        range.setEnd(endSpan.node, end - endSpan.start);
        this.ranges.push(range);
      }
      index = end;
    }

    if (this.ranges.length === 0) {
      this.current = -1;
    } else if (resetCurrent || this.current < 0) {
      this.current = 0;
      const top = this.content.getBoundingClientRect().top;
      for (let candidate = 0; candidate < this.ranges.length; candidate++) {
        if (this.ranges[candidate].getBoundingClientRect().bottom >= top) {
          this.current = candidate;
          break;
        }
      }
    } else {
      this.current = Math.min(this.current, this.ranges.length - 1);
    }
    this.applyHighlights();
    this.updateCount();
    if (reveal) this.revealCurrent();
  }

  private registry(): Map<string, unknown> | undefined {
    return (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  }

  private clearHighlights(): void {
    const registry = this.registry();
    registry?.delete("find-match");
    registry?.delete("find-current");
    if (!registry) window.getSelection()?.removeAllRanges();
  }

  private applyHighlights(): void {
    const registry = this.registry();
    const HighlightConstructor = (
      window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
    ).Highlight;
    if (registry && HighlightConstructor) {
      if (this.ranges.length > 0) {
        registry.set("find-match", new HighlightConstructor(...this.ranges));
        if (this.current >= 0) {
          registry.set("find-current", new HighlightConstructor(this.ranges[this.current]));
        } else {
          registry.delete("find-current");
        }
      } else {
        registry.delete("find-match");
        registry.delete("find-current");
      }
      return;
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = this.ranges[this.current];
    if (range) selection?.addRange(range.cloneRange());
  }

  private updateCount(): void {
    if (!this.queryText) {
      this.count.textContent = "";
      this.count.classList.remove("none");
    } else if (this.ranges.length === 0) {
      this.count.textContent = "无结果";
      this.count.classList.add("none");
    } else {
      this.count.classList.remove("none");
      const total = this.ranges.length >= FIND_MAX ? `${FIND_MAX}+` : String(this.ranges.length);
      this.count.textContent = `${this.current + 1}/${total}`;
    }
  }

  private revealCurrent(): void {
    const range = this.ranges[this.current];
    if (!range) return;
    const rectangle = range.getBoundingClientRect();
    if (rectangle.width === 0 && rectangle.height === 0) return;
    const contentRectangle = this.content.getBoundingClientRect();
    if (
      rectangle.top < contentRectangle.top + 60 ||
      rectangle.bottom > contentRectangle.bottom - 60
    ) {
      this.content.scrollTop +=
        rectangle.top -
        (contentRectangle.top + contentRectangle.height / 2) +
        rectangle.height / 2;
    }
  }
}
