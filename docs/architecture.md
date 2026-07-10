# Preview 模块化架构

Preview 的目标不是复刻系统预览，而是提供系统预览通常缺少的结构化阅读、内容感知翻译和可持续扩展能力。当前采用**编译期内建扩展**：格式实现随应用发布，不加载不受信任的运行时插件。

## 总体结构

```text
文件入口（打开 / 拖放 / Finder / CLI / 资源栏）
                    │
                    ▼
        Rust FileKind + Format Catalog
                    │
                    ▼
              ViewerHost
        ┌───────────┴───────────┐
        │  ViewerRegistry       │
        │  每次打开创建 Session │
        └───────────┬───────────┘
                    │
      ┌─────────────┼──────────────┐
      ▼             ▼              ▼
 MarkdownViewer  TextViewer   Image/HTML/... Viewer
                    │
                    ▼
        TextExtensionRegistry
      source + 格式渲染模式 + 翻译策略
```

- `src/app/`：应用启动、导航、Viewer 生命周期和全局事件路由。
- `src/features/`：外观、页内搜索、复制菜单、资源栏等跨 Viewer 功能。
- `src/viewers/`：每种顶层文件类型的预览实现。
- `src/viewers/text/`：文本格式、渲染模式和内容翻译策略的扩展边界。
- `src-tauri/src/formats.rs`：后端文件类型和扩展名的唯一运行时目录。
- `src-tauri/src/fsx.rs`：读取、编码检测、文本嗅探和目录枚举。

## Viewer 生命周期

`ViewerRegistry` 保存无状态 Factory；每次打开文件都会创建独立 `ViewerSession`。Session 拥有当前文件的 DOM、工具栏事件和格式状态，不能把文件级状态放回应用全局对象。

```ts
interface ViewerSession {
  mount(): Promise<void>;
  dispose(reason: "replace" | "reload" | "shutdown"): void | Promise<void>;
}
```

`ViewerHost` 是唯一的 Session 所有者，负责：

1. 检测文件类型；
2. 终止已过期的异步导航；
3. 释放旧 Session；
4. 从注册表创建并挂载新 Session；
5. 在挂载成功后更新文件监听和资源栏状态。

所有异步 Viewer 都必须在写入 DOM 前检查 `ViewerContext.isCurrent()`。这防止较慢的旧文件读取覆盖用户随后打开的新文件。

`mount()` 完成只代表可阅读的核心 DOM 已提交，不等待语法高亮、段落工具或 Mermaid 等增强。增强任务必须在首帧绘制后执行、可由 Session 的 `AbortSignal` 取消，并对超大代码块降级为未高亮源码，不能重新阻塞文件首屏。

## 顶层格式扩展

新增一种非文本顶层格式时：

1. 在 Rust `FileKind` 和格式目录中登记类型与扩展名；
2. 实现一个 `ViewerFactory` / `ViewerSession`；
3. 在 `createViewerRegistry()` 注册 Factory；
4. 同步系统文件关联；Rust 测试会检查格式目录是否被关联配置覆盖；
5. 添加该格式的解析、渲染和失败路径验证。

应用壳、复制菜单和页内搜索不应新增格式名称判断。格式特有行为由 Session 通过能力方法提供。

## 文本格式模型

所有非 Markdown 文本都进入 `TextViewer`。原始文本是不可变、权威的数据；树、表格、富文本或翻译结果都是可丢弃的投影。

```text
TextDocument.source
  ├─ source 模式（所有文本始终具备）
  ├─ json-tree / toml-tree / yaml-tree 等渲染模式
  └─ prose / code-comments 等翻译策略
```

### 渲染模式约束

- `source` 模式永远存在，且复制全文必须读取原始文件内容。
- 格式模式通过 `TextRenderMode` 注册，不在 `TextViewer` 中增加扩展名分支。
- 解析失败必须允许回退源码，不得修改或“修复”用户文件。
- 截断文件默认禁用需要完整文档的结构化解析。
- JSON 大整数、重复键，以及 YAML/TOML 的注释、顺序、标签、锚点等信息不能因为渲染投影而被静默覆盖。
- 渲染树应使用 DOM `textContent`，不能把文件内容直接拼入 `innerHTML`。

### 内容感知翻译约束

内容翻译通过 `TextTranslationStrategy` 扩展，例如全文自然语言、JSON 字符串值或代码注释。策略必须：

- 使用稳定、可复现的单元 ID，不能使用临时数组下标；
- 只替换明确选中的源范围，保留缩进、换行、注释符号和未翻译内容；
- 为缓存提供包含“策略 ID + 版本 + 有效提示词身份”的 `cacheProfile`；
- 使用语言解析器或可靠 tokenizer 识别代码注释，不能依赖正则或 Highlight.js 生成的 DOM；
- 翻译结果默认是预览投影，除非未来单独提供明确的导出/写回操作，否则不得修改源文件。

当前 Markdown 翻译命令仍保持原有协议。第二种翻译策略落地时，再增加面向原始文本单元、带 profile/run identity 的通用后端传输，避免为尚未实现的策略提前重写稳定链路。

## 安全与边界

- HTML 继续在禁脚本的 sandbox iframe 中展示，不能被通用 HTML Viewer 抽象绕过。
- Markdown、结构化树和未来文档渲染器必须分别维护自己的内容信任边界。
- Viewer 的 `dispose()` 默认只释放前端资源；是否取消后端任务由对应任务协议明确决定。
- Markdown 翻译事件携带唯一 `runId`；取消操作只允许取消匹配的运行实例，避免同路径重载或迟到操作污染新任务。
- 全局 Tauri 事件只注册一次，再转发给当前 Session，禁止在每次 `mount()` 时重复订阅。
- 运行时第三方插件暂不属于项目边界；先保证内建格式扩展简单、可审计、可测试。
