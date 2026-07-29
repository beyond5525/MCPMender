# MCPulse CLI

Cross-platform MCP diagnostics for Windows, macOS, and Linux.

## Install

```sh
npm install --global @mcpulse/cli
```

Node.js 20 or newer is required. The published CLI bundle includes MCPulse's
runtime code; it does not install a background service.

## Commands

```sh
mcpulse scan
mcpulse scan --json
mcpulse probe
mcpulse probe --run
mcpulse probe --run --server server-name
mcpulse repair
mcpulse repair --apply-safe
```

`scan` is read-only. `probe` without `--run` is also read-only and shows what
would be started or contacted. `probe --run` executes configured third-party
commands or contacts configured endpoints, so review the preview first.

Use `--lang en`, `--lang zh-CN`, or `--lang ja` with any command.

MCPulse is licensed under Apache-2.0.
