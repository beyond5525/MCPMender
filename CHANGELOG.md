# Changelog

All notable changes to MCPMender（协议修匠）are recorded here.

The project follows semantic versioning where practical. Versions containing
`beta` are pre-release builds and may change before v1.0.

## [0.3.0-beta.1] - 2026-07-29

### Added

- New MCPMender / 协议修匠 product identity, executable name, and CLI command.
- Desktop and CLI workflows for Windows, macOS, and Linux.
- Read-only configuration discovery and static diagnostics for Codex, Claude
  Desktop, Cursor, VS Code, Gemini CLI, and OpenCode.
- Opt-in stdio and Streamable HTTP MCP connection checks with bounded timeouts,
  tool-list inspection, and connection/process cleanup.
- Project-folder selection for project-level VS Code MCP configuration.
- Safe repair preview, local backup, content-change protection, verification,
  and rollback records.
- English, Simplified Chinese, and Japanese interface, CLI messages, and offline
  handbook.
- Redacted JSON support reports.
- Release packaging, checksum, native build, and smoke-test automation.
- Open-source contribution, security, privacy, conduct, issue, and release
  documentation.

### Security and privacy

- Static scans do not start configured commands or contact MCP endpoints.
- Deep checks require explicit user action because they can execute configured
  third-party commands or contact remote services.
- MCPMender contains no telemetry or automatic report upload.
- Beta signing limitations are documented: a Windows self-signed certificate
  and macOS ad-hoc signature are not automatically trusted by the operating
  system.

### Known beta limitations

- The beta is not a substitute for reviewing third-party MCP server code.
- Report redaction cannot guarantee removal of every project-specific secret.
- Safe repair supports only deterministic cases explicitly marked as eligible.
- Platform warnings, permissions, and desktop dependencies differ by operating
  system and require native validation.
- Windows SmartScreen and macOS Gatekeeper may warn because beta signatures do
  not establish a publicly trusted publisher identity.
