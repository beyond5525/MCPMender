# Contributing to MCPMender

MCPMender（协议修匠）welcomes focused bug fixes, tests, translations,
documentation improvements, and support for additional MCP configuration
formats.

## Before opening a change

1. Search existing Issues to avoid duplicate work.
2. For a user-facing change or a large new integration, open an Issue first and
   describe the problem, affected clients, and expected behavior.
3. For a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a
   public Issue.
4. Keep each pull request limited to one coherent outcome.

## Development setup

Requirements:

- Node.js 20 or newer;
- pnpm 10;
- Windows, macOS, or Linux.

Install and verify:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

On the repository's Windows development setup, the helper is also available:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\dev.ps1 build
```

## Change expectations

- Preserve the distinction between a read-only static scan and an opt-in deep
  check.
- Never execute configured code during `scan`.
- Show what a deep check will run or contact before execution.
- Bound network/process work with timeouts and clean up child processes.
- Never include real tokens, headers, private paths, or user configuration in
  fixtures, screenshots, reports, or commits.
- A repair must be deterministic, previewable, backed up, and protected against
  overwriting a file changed since scanning.
- Add or update tests for behavior changes.
- Keep English, Simplified Chinese, and Japanese user-facing text aligned.
- Update the offline handbook when behavior, safety guidance, installation, or
  commands change.
- Do not claim a platform was verified unless the test ran on that platform.

## Documentation and translations

The standalone handbook is `docs/MCPMender-Handbook.html`. It must remain fully
offline: no externally loaded script, stylesheet, image, or font.

Use the established terms consistently:

| English | 简体中文 | 日本語 |
|---|---|---|
| Scan | 普通扫描 / 检测 | 通常スキャン |
| Deep connection check | 深度连接检测 | 詳細接続診断 |
| Safe repair | 安全修复 | 安全な修復 |
| Not configured | 尚未配置 | 未設定 |

Avoid machine-only translations of security instructions. Ask a fluent reviewer
to check meaning and tone when possible.

## Pull request checklist

Before submitting:

- run tests, type checks, and builds relevant to the change;
- run `git diff --check`;
- describe which operating systems were actually tested;
- include screenshots only when they materially help review, with private
  information removed;
- document known limitations and skipped tests;
- confirm that no generated package, secret, local database, or private report
  was committed.

By contributing, you agree that your contribution is licensed under the
project's Apache-2.0 license and that you will follow
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
