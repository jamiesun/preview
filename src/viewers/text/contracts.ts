import type { FileInfo } from "../../api";

export interface TextDocument {
  file: FileInfo;
  source: string;
  encoding: string;
  truncated: boolean;
  extension: string;
  formatId: string;
}

export interface TextModeRenderContext {
  host: HTMLElement;
  signal: AbortSignal;
  isCurrent(): boolean;
}

export interface TextModeRenderResult {
  dispose?(): void;
}

export interface TextRenderMode {
  id: string;
  label: string;
  supports(document: TextDocument): boolean;
  render(
    document: TextDocument,
    context: TextModeRenderContext,
  ): void | TextModeRenderResult | Promise<void | TextModeRenderResult>;
}

export interface TextSourceRange {
  /** UTF-16 offsets into the immutable TextDocument.source string. */
  start: number;
  end: number;
}

export interface TextTranslationUnit {
  /** Stable within the strategy version; never use a transient array index. */
  id: string;
  source: string;
  /** Exact replaceable source span; delimiters and indentation stay outside when required. */
  range: TextSourceRange;
}

export type TextTranslationDisplay = "replace" | "bilingual";

export interface TextTranslationRenderContext extends TextModeRenderContext {
  document: TextDocument;
  mode: TextRenderMode;
  display: TextTranslationDisplay;
  results: ReadonlyMap<string, string>;
  /** Delegate a projected document back to the active format mode when appropriate. */
  renderMode(document: TextDocument): Promise<void | TextModeRenderResult>;
}

export interface TextTranslationPlan {
  /** Must include strategy identity/version and any effective prompt identity. */
  cacheProfile: string;
  units: readonly TextTranslationUnit[];
  /** Strategy-owned projection keeps source reconstruction and bilingual layout format-aware. */
  render(
    context: TextTranslationRenderContext,
  ): void | TextModeRenderResult | Promise<void | TextModeRenderResult>;
}

export interface TextTranslationStrategy {
  id: string;
  label: string;
  version: number;
  supports(document: TextDocument, modeId: string): boolean;
  createPlan(document: TextDocument): TextTranslationPlan | null;
}

export interface TextFormatExtension {
  id: string;
  label: string;
  extensions: readonly string[];
  modes?: readonly TextRenderMode[];
  translationStrategies?: readonly TextTranslationStrategy[];
}
