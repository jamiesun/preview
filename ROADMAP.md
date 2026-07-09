# Preview 路线图

类似 macOS 内置 Preview 的轻量文件预览应用，基于 **Tauri 2 + Rust**，特色是内置大模型翻译。

```
Tauri 2
├─ 前端 WebView
│  ├─ HTML:     iframe sandbox 渲染
│  ├─ Markdown: pulldown-cmark 渲染成 HTML（Rust 侧）
│  ├─ Text:     代码高亮、等宽字体、自动编码识别
│  ├─ Image:    img 缩放、旋转、适配窗口
│  └─ PDF:      pdf.js 渲染
│
└─ Rust 后端
   ├─ 文件读取 / 编码检测（chardetng + encoding_rs）
   ├─ 类型识别（扩展名 + 二进制嗅探）
   ├─ 翻译缓存（SQLite，按段落内容寻址）
   ├─ 文件监听（notify，外部修改热重载）
   ├─ 安全沙箱（HTML iframe sandbox / capability 最小化）
   └─ LLM 翻译（OpenAI 兼容 API，并发 + 可取消）
```

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

## M3 — PDF
- [ ] pdf.js 集成（分页、缩放、连续滚动）
- [ ] PDF 文本层抽取 → 复用翻译管线
- [ ] 备选：Rust 侧 pdfium-render 转位图（超大文件降级路径）

## M4 — 翻译体验增强
- [ ] 文本 / HTML 文件翻译（复用分段管线）
- [ ] 流式输出（SSE，逐 token 上屏）
- [ ] 多目标语言快速切换、术语表 / 自定义提示词模板
- [ ] 整篇导出：翻译后 Markdown / HTML
- [ ] API Key 存入 macOS Keychain（替代明文 JSON）

## M5 — 打磨
- [ ] KaTeX 数学公式渲染
- [ ] 目录（TOC）侧栏、Cmd+F 页内搜索
- [ ] 资源栏：目录变更监听刷新、右键菜单（在 Finder 显示等）、记住上次目录
- [ ] 打印 / 导出 PDF
- [x] 应用图标 / Logo（imagine 生成概念稿 → 手工矢量化 `assets/logo.svg` → tauri icon 全套图标）
- [ ] Quick Look 扩展调研
- [ ] HTML 预览「允许脚本」开关、更严格 CSP、iframe 内链接导航拦截
- [ ] 多标签 / 最近打开列表
- [ ] 自动更新（tauri-plugin-updater）

## 暂缓
- Office 文档（docx/xlsx/pptx）、压缩包、音视频、字体预览
