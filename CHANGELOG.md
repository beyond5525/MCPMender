# Changelog

All notable changes to MCPMender（协议修匠）are recorded here.

The project follows semantic versioning where practical. Versions containing
`beta` are pre-release builds and may change before v1.0.

## [Unreleased]

### Added

- Discover VSCodium user-level MCP configuration files automatically on
  Windows, macOS, and Linux while reusing the existing VS Code diagnostics.

## [0.3.0-beta.4] - 2026-07-30

### Fixed

- Force-closed timed-out stdio MCP server processes so diagnostics no longer
  leave background processes behind on Linux or macOS.

### Release engineering

- Made cross-platform compatibility tests use each runner's native paths and
  separators while retaining collective Windows, Linux, and macOS coverage.
- Updated maintained GitHub Actions dependencies and completed native package,
  launch, screenshot, shutdown, signature, and archive checks for Windows x64,
  Linux x64, macOS arm64, and macOS x64.
- Made the extracted Linux tarball smoke test compatible with an unprivileged
  hosted runner without changing the sandbox defaults of shipped packages.

## [0.3.0-beta.3] - 2026-07-30

### Fixed

- Prevented raw repair arguments, authorization details, credential URIs, and
  common token/password key variants from reaching Desktop or CLI output.
- Added client-specific schema checks and precedence handling so project
  configurations override shadowed user entries without running stale commands.
- Accepted VS Code inputs, environment files, workspace variables, socket URLs,
  numeric environment values, Insiders installations, and named Profiles.
- Added bounded VS Code Streamable HTTP to SSE fallback without retrying
  authentication failures, timeouts, or canceled requests.
- Made probe cancellation close active transports and child processes.
- Preserved UTF-8 BOM files during repair and isolated failures within a batch.
- Made Desktop repair and rollback history atomic, separated post-write
  warnings from mutation failures, and cleared stale scan/probe state.

### Release engineering

- Reworked local packaging around a verified staging directory with rollback,
  an adjacent ZIP checksum, explicit Ship gating, and a complete Electron SBOM.
- Stopped tag workflows from automatically publishing unsigned Windows builds;
  CI artifacts are now labeled clearly and require reviewed manual publication.
- Strengthened final Linux and macOS artifact smoke checks and help-window
  coverage.
- Replaced the unavailable npm-registry quick start with the bundled CLI
  tarball workflow and expanded the trilingual update, uninstall, data, and
  backup guidance.

## [0.3.0-beta.2] - 2026-07-30

### Fixed

- Corrected Windows `Path`/`PATH` command discovery and relative commands that
  depend on a configured working directory.
- Prevented disabled Codex, OpenCode, and Gemini servers from entering live
  checks.
- Added client-specific parsing for Codex authentication fields, Gemini HTTP
  and SSE transports, OpenCode V2 configuration, and project/user discovery.
- Hardened report redaction for URLs, authentication headers, structured
  secret keys, and separated command-line secret arguments.
- Blocked unsafe `cmd /c` repairs containing shell metacharacters.
- Made repair writes atomic, collision-safe, and resistant to concurrent
  configuration changes.
- Added persistent Desktop backup history with guarded rollback.
- Added cancellable Desktop deep checks, visible progress, localized failures,
  and narrow-window accessibility improvements.
- Made CLI option parsing strict and documented meaningful non-zero exit codes.
- Forced release builds to bundle current Core source and added artifact-level
  redaction and argument-validation tests.

### Release engineering

- Added tagged-source build metadata, CycloneDX SBOM generation, complete
  production dependency notices, and corrected `smol-toml` licensing.
- Added native Linux executable-permission checks and minimum Node.js 20 CLI
  validation to CI.
- Windows-built archives now contain only the natively tested Windows Desktop
  and cross-platform CLI. Linux and macOS Desktop packages are published only
  after their matching native CI jobs pass.

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
