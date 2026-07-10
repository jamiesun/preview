# Preview 路线图

基于 **Tauri 2 + Rust** 的专业文件阅读器。目标不是复刻 macOS Preview，而是在结构化文本、内容感知翻译、搜索与格式扩展能力上持续超越系统预览。

```
Tauri 2
├─ 前端应用壳
│  ├─ ViewerHost: 文件导航、Session 生命周期、过期异步任务隔离
│  ├─ ViewerRegistry: Markdown / Text / Image / HTML / PDF / Unknown
│  ├─ Features: 外观、搜索、复制菜单、资源栏
│  └─ TextExtensionRegistry
│     ├─ source（所有文本的权威源码视图）
│     ├─ render modes（JSON/TOML/YAML 等结构化投影）
│     └─ translation strategies（全文、字段、代码注释等内容策略）
│
└─ Rust 后端
   ├─ FileKind + 格式目录（扩展名统一注册）
   ├─ 文件读取 / 编码检测（chardetng + encoding_rs）
   ├─ 类型识别（扩展名 + 二进制嗅探）
   ├─ Markdown 解析与翻译缓存（SQLite）
   ├─ 文件监听（notify，外部修改热重载）
   └─ LLM 翻译（OpenAI 兼容 API，并发 + 可取消）
```

架构扩展约束见 [`docs/architecture.md`](./docs/architecture.md)。

## M0 — 骨架 ✅
- [x] Tauri 2 + Vite + vanilla-ts 脚手架
- [x] 多窗口（主窗口 + 设置窗口）、多页面 Vite 构建
- [x] 文件打开途径：拖放 / 打开对话框 / macOS「打开方式」(Apple Event) / CLI 参数
- [x] 文件类型识别（扩展名 + NUL 字节嗅探）

## M1 — Markdown 预览 + 翻译（P0，本仓库当前状态）✅
- [x] pulldown-cmark 渲染（表格 / 任务列表 / 脚注 / 删除线 / YAML front-matter）
- [x] 按顶层块分段渲染，段落级 `data-seg` 锚点
- [x] LLM 翻译：OpenAI 兼容 `/chat/completions`，段落级并发（信号量限流）、可取消（epoch）
- [x] 翻译缓存：SQLite，key = sha256(模型 | 目标语言 | 段落原文)，编辑后未变更段落秒回
- [x] 双语对照 / 仅译文 两种显示模式，逐段流式填充、失败可单段重试
- [x] 分段开关工具栏：原文（语言自动检测 whatlang）| 译文（目标语言下拉）| 双语对照
- [x] 复制：原文 / 译文 / 双语 Markdown、纯文本、HTML 富文本（当前视图）、段落级 hover 复制（⌘⇧C 复制原文）
- [x] 链接安全：文档内锚点应用内跳转；外部链接经确认后用系统浏览器打开；相对路径经确认后应用内预览
- [x] mermaid 流程图渲染（按需加载、暗色主题自适应、失败降级保留源码）
- [x] 外观：主题切换（自动/浅色/深色，全窗口生效）、内容宽度滑块、字号缩放（⌘±/⌘0）、字体族（默认/衬线/等宽），localStorage 持久化
- [x] 左侧资源栏：打开/拖入文件夹（⌘⇧O），树形懒加载展示，点击预览，当前文件高亮，可拖宽、可折叠（⌘B）
- [x] 配置窗口：API Base / Key / 模型 / 目标语言 / 并发 / 温度 / 自定义提示词、连接测试、缓存统计与清空
- [x] 文件监听热重载（保留滚动位置与翻译状态）
- [x] 代码高亮（highlight.js）

## M2 — 其余 P0 格式 ✅（基础版）
- [x] 纯文本：编码自动识别（BOM + chardetng）、等宽字体、语法高亮、大文件截断
- [x] 图片：缩放 / 旋转 / 适配窗口 / 实际大小（asset protocol）
- [x] HTML：iframe sandbox 渲染（默认禁脚本）

## M2.5 — 模块化扩展基座 ✅
- [x] Rust `FileKind` 枚举与统一格式目录，文件选择器从后端目录生成
- [x] 文件关联与格式目录一致性测试，避免扩展名配置漂移
- [x] `ViewerRegistry → ViewerSession` 生命周期，移除中央格式 `switch`
- [x] Markdown / Text / Image / HTML 独立 Viewer，格式状态不再堆积在应用全局对象
- [x] 外观、页内搜索、复制菜单、资源栏拆为跨 Viewer 功能模块
- [x] 导航 generation + `AbortSignal`，阻止慢文件覆盖后打开的文件
- [x] 首屏与增强渲染分离：高亮按需加载、首帧后分批执行、超大代码降级源码
- [x] 启动监听与设置读取并行，Finder / CLI 待打开队列串行排空
- [x] Markdown 翻译 `runId` 与作用域取消，隔离同路径重载和过期任务
- [x] `TextExtensionRegistry`、`TextRenderMode`、`TextTranslationStrategy` 扩展契约

## M3 — 结构化文本阅读
- [x] 所有非 Markdown 文本保留统一 `source` 模式和原始内容复制
- [x] 渲染模式按文本格式注册，解析失败可回退源码
- [ ] JSON 树状模式：折叠、路径复制、搜索、大文件保护
- [ ] TOML 结构模式：保留顺序并明确展示表、数组表和标量类型
- [ ] YAML 结构模式：多文档、锚点/别名、标签和解析失败提示
- [ ] 模式偏好按格式保存，源码与渲染视图的搜索/复制语义保持明确
- [ ] 为 XML、CSV、日志等格式保留独立模式接入能力，不在 `TextViewer` 增加特殊分支

## M4 — 内容感知翻译
- [ ] 通用文本翻译传输：原始文本单元、run identity、profile/version 缓存隔离
- [ ] 普通文本按段落翻译，支持原文 / 译文 / 双语视图
- [ ] JSON/YAML/TOML 可按字符串值或选中路径翻译，不破坏键名和结构
- [ ] 代码注释翻译：使用语言 tokenizer，保留注释符号、缩进、换行和未选中源码
- [ ] HTML 可见文本翻译，保持标签、属性和脚本边界
- [ ] 翻译投影默认只读；导出与写回必须作为显式、可审查的独立能力

## M5 — PDF
- [ ] pdf.js 集成（分页、缩放、连续滚动）
- [ ] 文本层、目录、链接和页内搜索
- [ ] PDF 文本抽取接入内容感知翻译策略
- [ ] 备选：Rust 侧 pdfium-render 转位图（超大文件降级路径）

## M6 — 翻译体验增强
- [ ] 流式输出（SSE，逐 token 上屏）
- [ ] 多目标语言快速切换、术语表 / 自定义提示词模板
- [ ] 整篇导出：翻译后 Markdown / HTML / 文本格式
- [ ] API Key 存入 macOS Keychain（替代明文 JSON）

## M7 — 打磨与系统级预览体验
- [ ] KaTeX 数学公式渲染
- [x] Cmd+F 页内搜索（全部高亮、上一个/下一个、大小写开关、跟随翻译视图）
- [ ] 目录（TOC）侧栏
- [ ] 资源栏：目录变更监听刷新、右键菜单（在 Finder 显示等）、记住上次目录
- [ ] 打印 / 导出 PDF
- [x] 应用图标 / Logo（imagine 生成概念稿 → 手工矢量化 `assets/logo.svg` → tauri icon 全套图标）
- [ ] Quick Look 扩展调研
- [ ] HTML 预览「允许脚本」开关、更严格 CSP、iframe 内链接导航拦截
- [ ] 多标签 / 最近打开列表
- [ ] 自动更新（tauri-plugin-updater）

## 方向储备
- Office 文档（docx/xlsx/pptx）、压缩包、音视频、字体预览
- 这些格式必须沿用 Viewer/Session 契约接入，不能重新进入应用壳增加格式特判
