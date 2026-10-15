<div align="center">

<img src="build/icon-mac.png" width="96" height="96" alt="Pi Desktop：翡翠绿 π 与终端光标图标" />

# Pi Desktop

**为开发者打造的本地 AI 编程工作台 —— 终端的自由，桌面的直觉。**<br />
*The Native Desktop Workspace for the Pi Coding Agent.*

[![Releases](https://img.shields.io/badge/download-GitHub%20Releases-386e5a?style=flat-square)](https://github.com/yeyuProject/pi-desktop-gui/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0f172a?style=flat-square)](#-快速开始)
[![Electron](https://img.shields.io/badge/Electron-44-47848f?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[设计理念](#-设计理念) · [核心特性](#-核心特性) · [快速开始](#-快速开始) · [快捷键与指令](#-快捷键与指令) · [参与开发](#-参与开发)

<br />

<img src="docs/assets/hero-banner.png" width="100%" alt="Pi Desktop 品牌概念图：会话侧栏、内联代码差异与相连的终端窗口" />

<p><sub>AI 生成品牌概念图</sub></p>

</div>

---

## 💡 设计理念

命令行编程智能体（CLI Coding Agent）拥有极高的执行效率与可组合性，但在面对**大段代码 Diff 审查、多分支思路探索、多模态图表输入、以及 MCP / Skills 生态配置**时，纯终端界面往往显得局促。

**Pi Desktop** 为此而生：

- **桌面与智能体在本机通信**：通过本地 `stdio` 上的 Pi RPC（按行传输 JSON，即 JSONL）驱动你机器上的 `pi`，桌面与智能体之间无需额外中转服务。
- **终端与 GUI 共用会话**：复用 Pi 会话历史、模型凭据与扩展配置。通过「在 Pi 终端继续」交接同一会话；关闭终端后回到桌面重新连接，也可从桌面打开终端创建的历史会话。
- **对话优先，审查随行**：保持简洁的对话流；当智能体修改代码时，按需展开工作区变更与内联 Diff，并可撤销纳入运行基线的文件修改。

<img src="docs/assets/architecture-bridge.png" width="100%" alt="架构概念图：Pi Desktop GUI 通过本机 stdio RPC（JSONL）连接 Pi CLI，复用 Skills、扩展与 Git 工作区，并由 Pi 连接模型服务和 MCP" />

会话与工作区保存在本机；模型请求沿用 Pi 的供应商配置，远程 MCP 也可能联网。「本地工作台」不代表所有推理都在本机完成。

---

## ✨ 核心特性

<img src="docs/assets/features-bento.png" width="100%" alt="六项能力概览：内联 Diff 与撤销、分支会话、MCP 与 Skills、终端与桌面交接、本地工作区、键盘操作" />

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧠 可视化智能体工作流</h3>
      <p>实时呈现模型返回的思考内容（Thinking）、工具调用参数与命令退出状态。代码修改直接在对话流内联渲染 Diff，底部显示上下文用量、Token 消耗与费用。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🌿 像 Git 一样分支对话</h3>
      <p>从历史用户消息编辑重发或 Fork 独立分支，切换分支时可生成总结，也可克隆活跃分支，围绕同一问题探索多种实现方案。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>⏪ 代码快照与文件撤销</h3>
      <p>在 Git 项目中，每次发送前用 Git 对象为工作区建立快照（存放在应用数据目录，不改动项目的 <code>.git</code>），支持二进制内容、原始换行符和 POSIX 文件权限恢复。支持<strong>撤销本轮文件修改</strong>或<strong>单独回滚指定文件</strong>；撤销本轮新建文件时移入回收站。快照有文件范围、单文件 50 MiB 和保留容量限制；命令产生的外部副作用不在文件撤销范围内。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔌 全栈生态控制中心</h3>
      <p>告别手写繁琐的配置文件。图形化管理多模型供应商（API Key / OAuth）、MCP 服务器工具暴露、Skills 技能包、扩展插件与提示词模板。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>⚡ 随手提问 vs 深度工程</h3>
      <p>启动即可开启<strong>独立对话</strong>，无需绑定代码仓库也能使用全套工具与联网扩展；进入<strong>项目会话</strong>则自动挂载文件树、Git 状态对比与工作区快照。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🖥️ 终端与桌面交接</h3>
      <p>支持在运行途中补充要求（Steer）或追加后续队列（Follow-up）。需要终端专用扩展界面时，点击<strong>「在 Pi 终端继续」</strong>沿用同一会话；关闭终端后可回到桌面重新连接。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🛡️ 工具审批模式</h3>
      <p>每个会话可选<strong>全自动</strong>、<strong>确认修改</strong>或<strong>只读</strong>。确认模式下，写文件、执行命令和调用外部工具前会出现确认卡片，可允许一次、本会话总是允许，或填写原因拒绝。只读模式仅放行内置读取与搜索工具，也会拦截手动 <code>!</code> / <code>!!</code> 命令；它控制工具调用，不是操作系统沙箱，不能限制扩展自身运行的代码。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🚀 减少长会话的重复渲染</h3>
      <p>主进程按变化位置推送消息和工具，保留未变化部分；消息组件和 Markdown 解析使用缓存，减少流式输出时的重复工作。窗口刷新后会重新同步完整运行状态。</p>
    </td>
  </tr>
</table>

v0.14.0 集中提供按轮次撤销、行范围引用、差异片段追问、细粒度审批、会话内全文查找和工作区变更提醒；同时新增面板拖动、只读工具分组、长文本片段、图片查看器、项目规则与模板编辑、本地用量统计。详细范围和实际验证边界见 [v0.14.0 验收记录](docs/v0.14-validation.md)。

同一工作目录内切换会话继续复用 Pi 进程，跨目录重新启动；模型请求失败显示中文原因和对应处理入口。已有恢复、应用内更新和 Pi 版本检查保持有效。

---

## 🚀 快速开始

### 1. 安装底层智能体引擎

Pi Desktop 依赖本机 Node.js（`>= 22.19`）与 Pi Coding Agent CLI：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

桌面端不限制 Pi 版本线，完整回归基准为 **1.1.0**。其他可识别的版本也允许连接和发送，仅显示“未验证”提示；实际交互仍检查协议格式。Pi 的升级由用户管理，桌面端不自动安装或升级 Pi。

> **Windows 用户提示**：请确保已安装 [Git for Windows](https://git-scm.com/download/win)（提供智能体执行命令所需的 Git Bash 环境）。

### 2. 下载桌面客户端

前往 [最新版本下载](https://github.com/yeyuProject/pi-desktop-gui/releases/latest) 下载对应系统的安装包。每个版本同时提供 `SHA256SUMS.txt`，用于核对下载文件：

| 平台 | 支持架构 | 分发格式 |
| :--- | :--- | :--- |
| **Windows** | `x64` | `-setup.exe` 安装版（推荐，支持自动更新） / `.exe` 便携版 |
| **macOS** | `Apple Silicon (M系列)` / `Intel` | `.dmg` 磁盘映像 / `.zip` |
| **Linux** | `x86_64` | `.AppImage` / `.deb` |

Windows 安装版按当前用户安装，无需管理员权限；它与便携版共用原有数据目录，切换后会话、草稿与设置仍可使用。v0.7.0 或更早版本需要先手动安装当前发行版，之后可使用应用内更新。

Windows 安装版和 Linux AppImage 启动 10 秒后检查更新，之后每 6 小时检查；默认后台下载，可在 **设置 → 关于与更新** 关闭。下载完成后点击侧栏的“重启以更新”，先查看更新说明，再选择立即重启或稍后；选择稍后会在下次正常退出时安装。任务或审批未结束时不能直接重启更新。

便携版、deb 和当前未签名的 macOS 版本只提示新版本，通过“前往下载”手动安装。网络失败不会弹窗打断任务，可在“关于与更新”查看原因、重试或打开版本页面。Windows 安装包目前也未签名，首次运行可能出现系统提示；更新下载会校验 SHA-512。

升级首次启动前保留原始索引 `state.pre-<旧版本>.json`，最多三份；旧索引没有记录应用版本时使用 `state.pre-unversioned.json`。若降级到不认识当前数据格式的应用，只读打开且不改写原文件。

<details>
<summary><b>macOS 首次打开提示「无法验证开发者」或「已损坏」？</b></summary>

应用目前尚未注入 Apple Developer 签名，首次打开请按住 `Control` 键点击应用图标并选择「打开」，或在终端运行以下命令解除隔离属性：

```bash
xattr -dr com.apple.quarantine "/Applications/Pi Desktop.app"
```
</details>

### 3. 连接模型并开始编程

1. 启动 **Pi Desktop**，应用会自动扫描系统及 `nvm` / `Homebrew` 路径下的 `pi` 运行时。
2. 点击右上角 **「Pi 功能 → 供应商与登录」**，配置你的模型服务商（支持 OAuth 登录、API Key 或任意 OpenAI 兼容接口；若终端已配置过 `~/.pi` 将自动识别）。
3. 在左下角选择模型与推理深度，即可开始对话或打开本地项目文件夹。

---

## ⌨️ 快捷键与指令

### 输入框指令语法

在输入框中通过前缀字符即可快速调用上下文与工具：

| 指令前缀 | 作用 | 用法示例 |
| :---: | :--- | :--- |
| **`@`** | 引用项目文件（也支持直接将文件或图片拖入输入框） | `@src/App.tsx 优化这里的渲染性能` |
| **`/`** | 唤起斜杠菜单，检索并调用 Skills、提示词模板与扩展命令 | `/commit` |
| **`//`** | 绕过桌面同名快捷键，直接调用底层 Pi 原生斜杠命令 | `//compact` |
| **`!`** | 直接在当前工作目录执行 Shell 命令，并将输出注入对话上下文 | `!npm test` |
| **`!!`** | 直接执行 Shell 命令，仅在本地查看结果，**不消耗**模型上下文 | `!!git status` |

### 常用全局快捷键

| 功能 | Windows / Linux | macOS |
| :--- | :---: | :---: |
| 新建独立对话 | `Ctrl + N` | `⌘ + N` |
| 全局搜索会话与历史消息 | `Ctrl + K` | `⌘ + K` |
| 查找当前会话正文、思考与工具结果 | `Ctrl + F` | `⌘ + F` |
| 展开 / 收起左侧边栏 | `Ctrl + B` | `⌘ + B` |
| 展开 / 收起右侧工作区 | `Ctrl + J` | `⌘ + J` |
| 切换变更 / 文件 / 输出页签 | `Alt + 1 / 2 / 3` | `⌥ + 1 / 2 / 3` |
| 打开设置中心 | `Ctrl + ,` | `⌘ + ,` |
| 查看快捷键速查面板 | `Ctrl + /` | `⌘ + /` |
| 翻阅当前会话发送历史（空输入框时） | `↑` / `↓` | `↑` / `↓` |
| 关闭右侧检查面板并聚焦输入框 | `Esc` | `Esc` |
| **紧急熔断**：停止全部正在执行的任务 | `连按两次 Esc` | `连按两次 Esc` |

---

## 🛠️ 参与开发

### 项目结构

```text
pi-desktop/
├── electron/           # Electron 主进程与系统桥接层
│   ├── main.ts         # 窗口生命周期、菜单与 IPC 路由
│   ├── rpc.ts          # Pi Agent stdio RPC 通信（JSONL）
│   ├── pi/protocol.ts  # Pi 核心响应校验与数据转换
│   ├── store.ts        # 索引、备份轮转与损坏恢复
│   ├── store-state.ts  # 项目、会话与设置的逐项校验
│   ├── updater.ts      # 检查、下载、安装策略及更新状态
│   ├── update-driver.ts # electron-updater 事件与安装接口适配
│   ├── workspace.ts    # 工作区文件监控、Git Diff 与快照回滚
│   ├── snapshot.ts     # 基于 Git 对象的私有运行快照
│   ├── pi-bridge.ts    # 注入 Pi 的桌面适配扩展（含工具审批）
│   ├── history.ts      # JSONL 会话树解析与全文检索
│   └── ...
├── src/                # React 19 渲染进程前端
│   ├── App.tsx         # 顶层布局组合
│   ├── components/    # 对话、输入、工作区、设置与恢复提示
│   ├── hooks/         # 运行状态、草稿、快捷键及面板操作
│   ├── features/      # 按页签组织 Pi 管理功能
│   └── lib/           # 纯展示函数、命令和平台文案
├── shared/             # 主进程与渲染进程共享类型契约、审批策略
└── scripts/            # 构建、打包与端到端自动化验收脚本
```

模块依赖、Pi 升级方式和恢复边界见 [架构说明](docs/architecture.md)。本地索引保存三份间隔至少十分钟的备份；恢复时显示具体备份时间。Pi 崩溃后不会自动重发提问，尚未执行的队列会回到草稿；若无法确认旧命令已经结束，会先阻止恢复和撤销，需手动结束命令后重启应用。

### 本地启动与构建

开发环境已内置锁定版本的 Pi 依赖，克隆仓库后即可直接运行：

```bash
# 克隆仓库
git clone https://github.com/yeyuProject/pi-desktop-gui.git
cd pi-desktop-gui

# 安装依赖
npm ci

# 启动热更新开发环境
npm run dev
```

其他常用工程命令：

```bash
npm run build            # TypeScript 类型检查 + 生产环境构建
npm test                 # 运行核心单元测试
npm run test:integration # 运行 Pi RPC 与工具链集成测试
npm run test:ui          # 运行 Playwright + Electron 端到端桌面交互测试
npm run test:update      # Windows/Linux 两个真实安装包的升级回归，使用独立数据及本地服务
npm run icons            # 从 1024 × 1024 原图重新导出各平台图标（在桌面环境执行）
npm run package          # 打包当前操作系统的发行安装包 (输出至 release/)
```

应用图标原图为 `build/icon-source-v2.png`，生成提示词保存在同目录的 `.prompt.txt` 文件中。运行 `npm run icons` 后一并提交 `icon.png`、`icon-mac.png`、`icon.ico`；CI 直接使用这些文件打包。

### GitHub 自动构建与发布

普通提交和 Pull Request 会在 Windows、macOS、Linux 上构建并执行测试。在 Actions 中手动运行 **Build, test and release**，测试通过后可以从该次运行的 Artifacts 下载安装包。

正式发布时，更新 `package.json` 的版本号与锁文件，补充 `docs/releases/v<版本>.md` 发布说明，再推送对应的 `v<版本>` 标签。三平台测试、Windows/Linux 升级回归和打包全部成功后，工作流会创建 GitHub Release，上传安装包、`latest.yml`、`latest-linux.yml`、`.blockmap` 与覆盖全部文件的 `SHA256SUMS.txt`。发布前校验更新清单的版本号、目标文件、大小和 SHA-512；标签版本必须与包版本一致。应用界面版本从包版本自动生成。

开发模式以及指定 `PI_DESKTOP_DATA_DIR` 的测试模式不会请求更新服务。升级回归单独打包真实应用，只在测试构建时改用 `127.0.0.1` 更新源和独立安装标识，并拦截、记录非本地请求。

---

## 📄 开源说明与致谢

- 核心智能体引擎基于 [@earendil-works/pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 构建。
- 本项目为社区驱动的独立桌面客户端，非官方发行版本。欢迎提交 Issue 与 Pull Request！
- README 插图与生成提示词见 [视觉素材说明](docs/assets/README.md)。
