# Privacy Notice

This notice describes MCPMender（协议修匠）0.3 beta. It applies to the Desktop
application and the `mcpmender` CLI.

## Short version

MCPMender runs locally and contains no account system, telemetry, analytics, or
automatic report upload. A normal scan reads supported local configuration but
does not start configured commands or contact configured MCP endpoints.

A deep check is different: when the user explicitly confirms it, MCPMender
starts the selected local MCP command or contacts the configured remote MCP
endpoint so it can perform a real protocol handshake.

## Data processed locally

Depending on the requested operation, MCPMender may process:

- supported MCP configuration file paths and contents;
- command names, arguments, working directories, URLs, and environment-variable
  references;
- configuration syntax and validation findings;
- MCP server identity, version, capabilities, tool names, status, duration, and
  error messages returned during a deep check;
- backup, verification, and rollback metadata for an applied safe repair;
- the selected project folder;
- language and handbook preferences stored locally.

This information remains on the computer unless the user chooses to export,
copy, or share it.

## Network and process activity

| Action | Starts configured commands | Contacts configured endpoints |
|---|---:|---:|
| Scan | No | No |
| Probe preview | No | No |
| Confirmed deep check | For selected stdio servers | For selected HTTP servers |
| Repair | No | No |

A configured command such as `npx` may itself download software or communicate
over the network. That behavior belongs to the selected third-party command and
its package manager, not to telemetry from MCPMender.

Installing MCPMender or its dependencies through npm, GitHub, or another package
service also contacts that service under its own privacy terms.

## Reports and redaction

Exported support reports are created locally. MCPMender attempts to omit or
redact common credential fields and secret patterns. Project-specific secrets
may not match known patterns, so users must inspect every exported report before
sharing it.

Do not publish raw MCP configuration, tokens, authorization headers, environment
values, private paths, or unreviewed logs in Issues.

## Backups and settings

An approved safe repair creates a local backup before writing. Backups and
rollback records remain local and may contain configuration data. Protect them
with the same care as the original configuration.

Desktop or handbook language preferences may be retained locally so the chosen
language can be restored. Clearing the application's local data resets those
preferences.

## Third-party services

MCPMender can diagnose third-party MCP servers only when the user requests a
deep check. Data sent to or returned by such a server is governed by that
server's operator and configuration. MCPMender cannot attest to the privacy or
security of a third-party server.

## Changes

Privacy behavior that changes network activity, telemetry, report export, or
stored data must be documented in the changelog and this notice. Because 0.3 is
a beta, details may change before v1.0; the notice distributed with a build
describes that build.
