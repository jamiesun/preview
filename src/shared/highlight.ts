import "highlight.js/styles/github.css";
import { scheduleAfterPaint } from "./schedule";

let highlighterPromise: Promise<typeof import("highlight.js/lib/common").default> | null = null;

function getHighlighter(): Promise<typeof import("highlight.js/lib/common").default> {
  highlighterPromise ??= import("highlight.js/lib/common").then((module) => module.default);
  return highlighterPromise;
}

export function scheduleCodeHighlighting(
  root: ParentNode,
  signal: AbortSignal,
  isCurrent: () => boolean,
): () => void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre code")).filter((block) => {
    if (block.classList.contains("language-mermaid")) return false;
    const length = block.textContent?.length ?? 0;
    const hasExplicitLanguage = Array.from(block.classList).some((name) =>
      name.startsWith("language-"),
    );
    return length <= (hasExplicitLanguage ? 80_000 : 20_000);
  });
  if (blocks.length === 0) return () => {};

  let index = 0;
  let timer: number | undefined;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
  signal.addEventListener("abort", cancel, { once: true });

  const processChunk = async () => {
    const highlighter = await getHighlighter();
    if (cancelled || signal.aborted || !isCurrent()) return;
    const deadline = performance.now() + 8;
    while (index < blocks.length && performance.now() < deadline) {
      const block = blocks[index++];
      if (!block.isConnected) continue;
      const languageClass = Array.from(block.classList).find((name) => name.startsWith("language-"));
      const language = languageClass?.slice("language-".length);
      if (language && !highlighter.getLanguage(language)) continue;
      try {
        highlighter.highlightElement(block);
      } catch {
        // Highlighting is an enhancement; readable source remains intact on failure.
      }
    }
    if (index < blocks.length && !cancelled && isCurrent()) {
      timer = window.setTimeout(() => void processChunk(), 0);
    }
  };

  const cancelInitial = scheduleAfterPaint(() => void processChunk(), signal);
  return () => {
    cancelInitial();
    cancel();
  };
}
