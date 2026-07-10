# Preview

<p align="center">
  <img src="./assets/logo.png" width="160" alt="Preview logo" />
</p>

面向专业阅读与内容理解的轻量文件预览应用，基于 **Tauri 2 + Rust**。目标不是复刻 macOS「预览」，而是在结构化文本、内容感知翻译和格式扩展能力上超越系统预览。

## 已支持

| 格式 | 能力 |
| --- | --- |
| Markdown | pulldown-cmark 渲染、GFM 表格/任务列表/脚注、代码高亮、**LLM 翻译（双语对照/仅译文，SQLite 缓存）**、源语言自动检测、多格式复制（原文/译文/双语 Markdown、纯文本、HTML）、外部修改热重载 |
| 文本/代码 | 自动编码识别（chardetng）、语法高亮、统一源码视图；结构化渲染模式将按格式逐步加入 |
| 图片 | 缩放、旋转、适配窗口 |
| HTML | iframe sandbox 安全渲染 |
| PDF | 规划中（见 [ROADMAP](./ROADMAP.md)） |

## 打开文件

拖放到窗口 / `⌘O` 对话框 / Finder「打开方式」/ `preview <file>` 命令行参数。

## 页内搜索

`⌘F` 打开查找栏：全部匹配高亮、`↩`/`⇧↩`（或 `⌘G`/`⇧⌘G`）跳转上下一个、`Aa` 切换大小写敏感、`Esc` 关闭。搜索跟随当前视图——双语/仅译文模式下同样检索译文，文档热重载或翻译到达时结果自动刷新。

## 翻译配置

工具栏 ⚙︎ 打开设置窗口，填写 OpenAI 兼容 API（OpenAI / DeepSeek / Ollama / vLLM 等均可）：API Base、API Key、模型、目标语言、并发数。支持连接测试与翻译缓存管理。

翻译按 Markdown 顶层块分段并发执行，缓存 key 为 `sha256(模型|语言|段落原文)`——重开文件或修改文档后，未变更段落即时命中缓存。

## 架构与扩展

前端采用 `ViewerRegistry → ViewerSession` 生命周期架构；Markdown、文本、图片和 HTML 各自维护状态与工具栏。所有非 Markdown 文本统一进入 `TextViewer`，通过渲染模式和内容翻译策略扩展 JSON 树、TOML/YAML 结构视图及代码注释翻译。

扩展契约、生命周期和安全边界见 [`docs/architecture.md`](./docs/architecture.md)。

## 开发

```bash
npm install
npm run tauri dev        # 开发
npm run tauri build      # 打包
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 单元测试
```

## 路线图

见 [ROADMAP.md](./ROADMAP.md)。
