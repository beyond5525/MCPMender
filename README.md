# MCPMender · 协议修匠

MCPMender（协议修匠）是一款在本地运行的 MCP 配置诊断与安全修复工具，
同时提供 Desktop 图形界面和 `mcpmender` 命令行。

It helps people find out why an MCP server is not visible, will not start, or
cannot complete an MCP handshake in Codex, Claude Desktop, Cursor, VS Code,
Gemini CLI, and OpenCode.

> **Release status:** `0.3.0-beta.2`. This is a public beta, not a stable v1.0
> release. Keep a copy of important configuration and review every repair
> preview before applying it.

## What it does

- Discovers supported MCP configuration files on Windows, macOS, and Linux.
- Checks JSON/JSONC/TOML syntax, commands, environment references, and URLs.
- Separates safe static scanning from opt-in live connection testing.
- Performs real MCP initialize handshakes over stdio or Streamable HTTP.
- Shows tool-list availability, timeouts, authentication failures, and process
  cleanup results.
- Previews deterministic low-risk repairs, backs up the original file, verifies
  that it has not changed, and supports rollback records.
- Exports machine-readable reports with common credentials and secret values
  redacted.
- Provides English, Simplified Chinese, and Japanese in the app, CLI, and
  bundled offline handbook.

MCPMender does not provide MCP servers, recover provider tokens, or guarantee
that a discovered third-party server is trustworthy.

## Scan or deep check?

| Operation | Runs configured MCP code? | Contacts remote MCP endpoints? | Writes configuration? | Best used for |
|---|---:|---:|---:|---|
| **Scan / 普通扫描** | No | No | No | Finding malformed files, missing commands, missing environment references, and invalid URLs safely |
| **Probe / 深度检测** | Yes, after confirmation | Yes, after confirmation | No | Proving that a server starts or responds to a real MCP handshake |
| **Safe repair / 安全修复** | No | No | Only after confirmation | Applying an explicitly eligible repair after backup and change detection |

Always review `mcpmender probe` before running `mcpmender probe --run`.
Configured commands are third-party code, and commands such as `npx` may
download packages.

## Desktop installation

Download the artifact for your operating system from the project Releases page.
The exact artifact names are recorded in the release notes and checksum file.

### Windows

1. Extract the release archive.
2. Open the portable MCPMender `.exe`; installation is not required.
3. If Windows displays a publisher or SmartScreen warning, verify the published
   SHA-256 checksum before deciding whether to run it.

Beta Windows builds may use a self-signed certificate. A self-signed signature
can help detect modification, but it is **not trusted automatically by Windows,
Microsoft Defender SmartScreen, or other computers**. It is not equivalent to a
commercially issued code-signing certificate.

### macOS

1. Choose the Apple Silicon package for M-series Macs or the Intel package for
   Intel Macs.
2. Open the DMG and move MCPMender to Applications, or extract the ZIP.
3. If macOS blocks the first launch, inspect the app in **System Settings →
   Privacy & Security** and use the system-provided approval flow only if the
   checksum matches the release.

Beta macOS builds may use ad-hoc signing and may not be notarized. Ad-hoc signing
does **not establish developer identity and is not trusted by Gatekeeper**.
Users should expect an operating-system warning.

### Linux

For an AppImage:

```sh
chmod +x MCPMender*.AppImage
./MCPMender*.AppImage
```

For a tar.gz package:

```sh
tar -xzf MCPMender*.tar.gz
cd MCPMender*/
./mcpmender
```

Linux distributions differ in their available desktop libraries. If the app
does not start, run it from a terminal and include the error output in a bug
report after removing private paths and credentials.

## Command-line installation

The published package requires Node.js 20 or newer:

```sh
npm install --global mcpmender@beta
mcpmender --version
mcpmender --help
```

To test a downloaded npm tarball before registry publication:

```sh
npm install --global ./mcpmender-0.3.0-beta.2.tgz
```

Common commands:

```sh
mcpmender scan
mcpmender scan --json
mcpmender scan --lang zh-CN
mcpmender probe
mcpmender probe --run
mcpmender probe --run --server server-name
mcpmender repair
mcpmender repair --apply-safe
```

`--lang en`, `--lang zh-CN`, and `--lang ja` are supported.

CLI exit codes are stable for automation:

| Exit code | Meaning |
| ---: | --- |
| `0` | Command completed and no blocking scan/probe failure was found |
| `1` | Invalid command/options, unmatched server filter, or unexpected runtime failure |
| `2` | Scan found errors, or a live probe failed/required authentication |
| `3` | At least one requested safe repair was skipped or failed |

The Desktop backup-history panel can restore a recorded repair only when the
current configuration still matches the repaired version. This prevents
rollback from silently overwriting later user edits.

## Privacy and security

- No account, telemetry, analytics, or MCPMender cloud service is required.
- Scans, reports, backups, and settings stay on the local computer unless the
  user deliberately shares them.
- A static scan does not start configured commands or contact MCP endpoints.
- A deep check necessarily starts the selected local command or contacts the
  selected remote endpoint.
- Report redaction reduces accidental disclosure but is not a guarantee; review
  an exported report before sharing it.
- MCP configuration can contain executable commands and secrets. Do not publish
  raw configuration files in Issues.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Development

The repository uses pnpm workspaces:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 desktop
```

Run the CLI from the checkout:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- scan --lang zh-CN
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- probe
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- probe --run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- repair
```

The offline three-language handbook is
[`docs/MCPMender-Handbook.html`](docs/MCPMender-Handbook.html). See
[CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## Release confidence

Release artifacts should be built and smoke-tested on their native operating
systems. A passing automated build proves repeatability, but does not replace
manual checks of operating-system warnings, fonts, permissions, configuration
discovery, deep-check cleanup, report export, and rollback.

The release owner uses [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) to record
what was actually verified. Missing native or manual checks must be disclosed in
the release notes instead of being described as passed.

## License

Apache-2.0. See [LICENSE](LICENSE). Direct dependency sources and licenses are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
