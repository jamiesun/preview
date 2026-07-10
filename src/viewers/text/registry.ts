import type {
  TextDocument,
  TextFormatExtension,
  TextRenderMode,
  TextTranslationStrategy,
} from "./contracts";
import { sourceTextMode } from "./source-mode";

const BUILTIN_TEXT_FORMATS: readonly TextFormatExtension[] = [
  { id: "json", label: "JSON", extensions: ["json"] },
  { id: "toml", label: "TOML", extensions: ["toml"] },
  { id: "yaml", label: "YAML", extensions: ["yaml", "yml"] },
  {
    id: "code",
    label: "代码",
    extensions: [
      "js", "mjs", "cjs", "ts", "py", "rb", "rs", "go", "java", "kt",
      "c", "h", "cpp", "hpp", "cs", "swift", "sh", "bash", "zsh", "css",
      "scss", "ini", "sql", "xml", "php", "lua", "diff", "patch",
    ],
  },
];

const FALLBACK_FORMAT: TextFormatExtension = {
  id: "plain",
  label: "文本",
  extensions: [],
};

export class TextExtensionRegistry {
  private readonly formats: TextFormatExtension[] = [];
  private readonly extensionIndex = new Map<string, TextFormatExtension>();

  constructor(formats: readonly TextFormatExtension[] = []) {
    formats.forEach((format) => this.register(format));
  }

  register(format: TextFormatExtension): void {
    if (this.formats.some((item) => item.id === format.id)) {
      throw new Error(`重复的文本格式扩展: ${format.id}`);
    }
    const modeIds = new Set<string>([sourceTextMode.id]);
    for (const mode of format.modes ?? []) {
      if (modeIds.has(mode.id)) throw new Error(`重复或保留的文本模式: ${mode.id}`);
      modeIds.add(mode.id);
    }
    const strategyIds = new Set<string>();
    for (const strategy of format.translationStrategies ?? []) {
      if (strategyIds.has(strategy.id)) throw new Error(`重复的文本翻译策略: ${strategy.id}`);
      strategyIds.add(strategy.id);
    }
    for (const extension of format.extensions) {
      const normalized = extension.toLowerCase();
      if (this.extensionIndex.has(normalized)) {
        throw new Error(`文本扩展名已注册: ${normalized}`);
      }
      this.extensionIndex.set(normalized, format);
    }
    this.formats.push(format);
  }

  resolve(extension: string): TextFormatExtension {
    return this.extensionIndex.get(extension.toLowerCase()) ?? FALLBACK_FORMAT;
  }

  modesFor(document: TextDocument): readonly TextRenderMode[] {
    const format = this.resolve(document.extension);
    return [sourceTextMode, ...(format.modes ?? [])].filter((mode) => mode.supports(document));
  }

  translationStrategiesFor(
    document: TextDocument,
    modeId: string,
  ): readonly TextTranslationStrategy[] {
    return (this.resolve(document.extension).translationStrategies ?? []).filter((strategy) =>
      strategy.supports(document, modeId),
    );
  }
}

export const textExtensionRegistry = new TextExtensionRegistry(BUILTIN_TEXT_FORMATS);
