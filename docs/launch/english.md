# MCPMender launch copy — English

These drafts are ready to publish with the repository link. Replace only the
opening sentence when a community requires a specific title format. Do not
remove the public-beta or platform-signing disclosures.

Repository: https://github.com/beyond5525/MCPMender

Downloads: https://github.com/beyond5525/MCPMender/releases/tag/v0.3.0-beta.4

## Short post

**MCP server not showing up? MCPMender helps find out why.**

MCPMender is an open-source, local-first diagnostic and safe-repair tool for
MCP configurations used by Codex, Claude Desktop, Cursor, VS Code, Gemini CLI,
and OpenCode.

Start with a read-only scan, opt in to a real MCP handshake only when needed,
and preview eligible low-risk repairs before anything changes. Repairs create a
backup and rollback record. Desktop and CLI are available for Windows, macOS,
and Linux, with English, Simplified Chinese, and Japanese interfaces.

Public beta: https://github.com/beyond5525/MCPMender

MCPMender cannot repair every server or verify that third-party code is safe.
Beta builds may also trigger operating-system signing or trust warnings; verify
the published checksum before running them.

## Long post

**Show HN / Project introduction: MCPMender, a local MCP configuration
diagnostic and safe-repair tool**

When an MCP server does not appear in a client, the visible symptom is often
the same even though the cause is not: malformed JSON or TOML, a missing
command, an unresolved environment variable, an invalid URL, an authentication
failure, a startup timeout, or a failed MCP handshake.

I built MCPMender to make that investigation more understandable without
requiring everyone to be comfortable debugging configuration files in a
terminal.

The public beta includes:

- A Desktop application and a `mcpmender` command-line interface.
- Configuration discovery for Codex, Claude Desktop, Cursor, VS Code, Gemini
  CLI, and OpenCode.
- A read-only static scan that does not start configured commands or contact
  remote MCP endpoints.
- An explicitly confirmed live probe that can perform a real MCP initialize
  handshake over stdio or Streamable HTTP.
- Previewable, deterministic low-risk repairs with file backups, change
  detection, and rollback records.
- Locally generated reports with common secret values redacted.
- English, Simplified Chinese, and Japanese interfaces and an offline handbook.
- Windows, macOS, and Linux builds.

The project is intentionally conservative about automatic repair. It does not
try to guess provider tokens, install arbitrary MCP servers, or promise that a
third-party command is trustworthy. A live probe can execute configured code or
contact a remote endpoint, so MCPMender shows that boundary and asks for
confirmation first.

This is version 0.3.0-beta.4, not a stable 1.0 release. Windows builds may use a
self-signed certificate, while macOS builds may be ad-hoc signed and not
notarized. Users should inspect the release notes and verify the published
SHA-256 checksum before running a download.

Repository and screenshots:
https://github.com/beyond5525/MCPMender

Downloads:
https://github.com/beyond5525/MCPMender/releases/tag/v0.3.0-beta.4

Feedback is especially useful for reproducible, redacted MCP configuration
failures and platform-specific behavior. Please do not post raw configuration
files containing credentials or private paths.
