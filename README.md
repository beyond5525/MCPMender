# MCPulse

MCPulse is a local diagnostics and safe-repair center for MCP connections used
by AI developer tools. It provides both a CLI and a desktop application.

## Current status

The first development slice includes:

- local discovery for Codex, Claude Desktop, Cursor, VS Code, Gemini CLI, and OpenCode;
- English, Simplified Chinese, and Japanese with instant switching;
- static MCP configuration checks;
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

## Privacy and safety

- No account and no telemetry.
- No configuration or logs are uploaded.
- Reports redact common token and secret shapes.
- Repairs create a local backup before writing.
- Only deterministic, low-risk repairs are eligible for one-click repair.

## License

Apache-2.0. See `LICENSE`.
