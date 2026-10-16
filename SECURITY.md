# Security Policy

## Supported versions

Only the [latest release](https://github.com/yeyuProject/pi-desktop-gui/releases/latest) receives security fixes. Please update before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through [GitHub Security Advisories](https://github.com/yeyuProject/pi-desktop-gui/security/advisories/new). Include:

- affected version and operating system,
- steps to reproduce or a proof of concept,
- the impact you expect (for example, bypassing tool approval or writing outside the project).

We aim to acknowledge reports within 7 days and will keep you informed while a fix is prepared. Credit is given in the release notes unless you prefer otherwise.

## Scope

In scope: the Pi Desktop application in this repository — IPC between renderer and main process, the bundled bridge extension, tool approval enforcement, workspace snapshots and restore, the update mechanism and stored app data.

Out of scope, please report upstream:

- the Pi Coding Agent CLI and its built-in tools — [@earendil-works/pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent);
- third-party Pi extensions, Skills and MCP servers;
- model providers.

Note that the read-only and confirm approval modes control tool calls made through Pi. They are not an operating-system sandbox and cannot restrict code that an installed extension runs by itself.

---

## 简体中文

安全问题请**不要**公开提交 Issue，请通过 [GitHub Security Advisories](https://github.com/yeyuProject/pi-desktop-gui/security/advisories/new) 私下报告，并附上版本、系统、复现步骤及影响。只有最新版本会接收安全修复。Pi CLI、第三方扩展、MCP 服务和模型服务的问题请向对应项目报告。只读与确认模式控制通过 Pi 发起的工具调用，不是操作系统沙箱。
