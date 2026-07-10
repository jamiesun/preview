import { scheduleCodeHighlighting } from "../../shared/highlight";
import type { TextRenderMode } from "./contracts";

const EXTENSION_LANGUAGES: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript",
  py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", kt: "kotlin",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", swift: "swift",
  sh: "bash", bash: "bash", zsh: "bash", json: "json", yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", css: "css", scss: "scss", sql: "sql", xml: "xml",
  php: "php", lua: "lua", diff: "diff", patch: "diff",
};

export const sourceTextMode: TextRenderMode = {
  id: "source",
  label: "源码",
  supports: () => true,
  render(textDocument, context) {
    const pre = window.document.createElement("pre");
    pre.className = "text-view";
    const code = window.document.createElement("code");
    code.textContent = textDocument.source;
    pre.appendChild(code);
    context.host.replaceChildren(pre);

    const language = EXTENSION_LANGUAGES[textDocument.extension];
    if (
      language &&
      textDocument.source.length <= 80_000 &&
      context.isCurrent()
    ) {
      code.classList.add(`language-${language}`);
      const cancel = scheduleCodeHighlighting(pre, context.signal, context.isCurrent);
      return { dispose: cancel };
    }
  },
};
