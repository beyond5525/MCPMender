# MCPMender CLI

Cross-platform MCP diagnostics for Windows, macOS, and Linux.

## Install

```sh
npm install --global mcpmender@beta
```

Node.js 20 or newer is required. The published CLI bundle includes MCPMender's
runtime code; it does not install a background service.

## Commands

```sh
mcpmender scan
mcpmender scan --json
mcpmender probe
mcpmender probe --run
mcpmender probe --run --server server-name
mcpmender repair
mcpmender repair --apply-safe
```

`scan` is read-only. `probe` without `--run` is also read-only and shows what
would be started or contacted. `probe --run` executes configured third-party
commands or contacts configured endpoints, so review the preview first.

Use `--lang en`, `--lang zh-CN`, or `--lang ja` with any command.

Unknown options, missing values, and unmatched `--server` filters are rejected.
Exit codes are:

- `0`: completed without a blocking finding;
- `1`: invalid input, unmatched filter, or runtime failure;
- `2`: scan/probe error or authentication-required result;
- `3`: at least one requested repair was skipped or failed.

MCPMender is licensed under Apache-2.0.
