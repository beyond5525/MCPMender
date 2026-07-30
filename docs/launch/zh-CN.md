# MCPMender 首发推广文案——简体中文

以下内容可以直接发布并附上项目链接。如果社区对标题格式有要求，只需调整第一
句话。请保留“公开测试版”和系统签名限制说明。

项目主页：https://github.com/beyond5525/MCPMender

下载页面：https://github.com/beyond5525/MCPMender/releases/tag/v0.3.0-beta.4

## 短帖

**MCP Server 不显示、启动失败，却不知道问题在哪里？可以试试协议修匠。**

MCPMender（协议修匠）是一款开源、本地运行的 MCP 配置诊断与安全修复工具，
支持 Codex、Claude Desktop、Cursor、VS Code、Gemini CLI 和 OpenCode。

它会先进行不启动 MCP 命令、不连接远程端点的只读检测；确有需要时，用户再主动
执行真实 MCP 握手测试。符合条件的低风险问题可以先预览、再修复，并自动生成
备份和回滚记录。项目同时提供 Windows、macOS、Linux 桌面端和命令行，界面支持
英文、简体中文和日语。

公开测试版：https://github.com/beyond5525/MCPMender

协议修匠不能修复所有服务，也不能证明第三方代码一定安全。Beta 安装包还可能
触发操作系统的签名或信任提示，运行前请核对发布页面提供的校验值。

## 长帖

**开源项目：协议修匠——把 MCP 配置排错和安全修复做成桌面工具与命令行**

MCP Server 没有出现在客户端中时，表面现象很相似，实际原因却可能完全不同：
JSON 或 TOML 格式错误、启动命令不存在、环境变量没有设置、URL 无效、鉴权
失败、启动超时，或者 MCP 握手失败。

协议修匠的目标，是让不习惯手动排查配置文件的用户也能看懂“哪里出了问题”，
同时给熟悉终端的用户保留可用于脚本和自动化的命令行。

当前公开测试版包括：

- Desktop 图形界面和 `mcpmender` 命令行。
- 自动发现 Codex、Claude Desktop、Cursor、VS Code、Gemini CLI 和 OpenCode
  的 MCP 配置。
- 默认进行只读静态检测，不启动配置中的命令，也不连接远程 MCP 端点。
- 经过明确确认后，可通过 stdio 或 Streamable HTTP 执行真实 MCP initialize
  握手。
- 对确定、低风险的问题提供修复预览，并在修改前备份，检测文件是否被他处
  改动，同时保存回滚记录。
- 报告在本地生成，并对常见密钥和敏感值进行隐藏处理。
- 软件、命令行和离线教程均支持英文、简体中文和日语。
- 提供 Windows、macOS 和 Linux 版本。

项目在自动修复方面刻意保持谨慎：不会猜测或找回服务商 Token，不会擅自安装
任意 MCP Server，也不会声称第三方命令一定可信。真实连接检测可能执行配置中的
程序或访问远程地址，因此软件会先说明风险并要求用户确认。

目前版本是 0.3.0-beta.4，并非稳定版 1.0。Windows 版本可能使用自签名证书；
macOS 版本可能采用临时签名且未经过 Apple 公证。下载安装后，请先阅读发布说明
并核对 SHA-256 校验值。

项目主页、源代码和三语截图：
https://github.com/beyond5525/MCPMender

下载页面：
https://github.com/beyond5525/MCPMender/releases/tag/v0.3.0-beta.4

欢迎反馈能够稳定复现、并且已经脱敏的 MCP 配置问题和不同系统上的使用表现。
请不要在 Issue 中粘贴包含密钥、Token 或私人路径的原始配置文件。
