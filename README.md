# MCPulse

MCPulse is a local diagnostics and safe-repair center for MCP connections used
by AI developer tools. It provides both a CLI and a desktop application.

## Current status

The first development slice includes:

- local discovery for Codex, Claude Desktop, Cursor, VS Code, Gemini CLI, and OpenCode;
- platform-correct discovery paths for Windows, macOS, and Linux;
- English, Simplified Chinese, and Japanese with instant switching;
- read-only checks for syntax, commands, environment references, and URLs;
- opt-in deep connection checks using real MCP initialize handshakes, bounded
  timeouts, tool-list verification, and connection/process cleanup;
- safe Windows `npx` repair plans for JSON/JSONC configurations;
- repair preview, local backup, verification, and rollback records;
- redacted JSON support reports;
- a standalone offline handbook covering onboarding, operations, safety,
  troubleshooting, FAQs, habits, and terminology in all three languages;
- shared behavior between the CLI and Desktop.

MCPulse is pre-release software. The default scan is read-only. Repairs are
never applied without explicit confirmation.

## Development

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 desktop
```

Run the CLI:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- scan --lang zh-CN
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- scan --json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- probe
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- probe --run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 cli -- repair --plan
```

This checkout intentionally keeps the project on `H:\MCPulse` and its Node,
pnpm, package store, build caches, and temporary files under
`F:\GemeHuanJing\MCPulseTools`.

The offline handbook source is `docs/MCPulse-Handbook.html`. It is copied into
the Desktop package and opened from the **Tutorial & help** button.

Windows portable packaging is available through `desktop:dist`. macOS DMG/ZIP
and Linux AppImage/tar.gz targets are configured as `desktop:dist:mac` and
`desktop:dist:linux`; release artifacts should be produced and smoke-tested on
their respective operating systems.

The `Native release builds` GitHub Actions workflow builds and performs a
non-interactive UI smoke test on Windows x64, Linux x64, macOS Apple Silicon,
and macOS Intel runners. It also packs and install-tests the Node.js 20+ CLI.
The workflow can be started manually or by pushing a `v*` tag. macOS packages
are unsigned until Apple signing and notarization credentials are configured.

## Privacy and safety

- No account and no telemetry.
- No configuration or logs are uploaded.
- Reports redact common token and secret shapes.
- The default scan never starts configured third-party commands.
- Deep checks show a preview and require explicit confirmation because local
  commands can run third-party code and `npx` can download packages.
- Deep checks use bounded timeouts and close spawned processes and HTTP sessions.
- Repairs create a local backup before writing.
- Only deterministic, low-risk repairs are eligible for one-click repair.

## License

Apache-2.0. See `LICENSE`.

Direct dependency sources and licenses are documented in
`THIRD_PARTY_NOTICES.md`.
