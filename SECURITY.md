# Security Policy

Thank you for helping keep MCPMender（协议修匠）and its users safe.

## Supported versions

| Version | Security support |
|---|---|
| 0.3.0 beta | Best-effort fixes during the beta period |
| Earlier development builds | Not supported |

Beta support means verified vulnerabilities will be triaged and fixed when
practical. It does not imply the stability or response-time guarantees of a
commercial support contract.

## Reporting a vulnerability

Do not open a public Issue for a vulnerability, suspected credential exposure,
or an exploit that has not been fixed.

Use the repository's private **GitHub Security Advisories** reporting feature.
Include:

- the affected MCPMender version and operating system;
- the affected component: Desktop, CLI, scanner, probe, repair, report, or
  packaging;
- a concise impact statement and reproducible steps;
- a minimal proof of concept with secrets and personal paths removed;
- whether the issue can execute a command, overwrite configuration, expose a
  credential, bypass confirmation, or leave a process running;
- any suggested mitigation.

If private vulnerability reporting is not enabled, open a public Issue that
contains **only a request for a private security contact channel**. Do not
include vulnerability details, tokens, raw MCP configuration, or private logs.

Maintainers should acknowledge a private report, assess its severity, coordinate
a fix and release, and credit the reporter if requested. Exact timing depends on
severity, reproducibility, and maintainer availability.

## Security boundaries

MCPMender:

- treats ordinary scanning as read-only and does not start configured MCP code;
- requires explicit action for a deep check;
- may execute configured third-party commands during a confirmed deep check;
- may contact configured remote endpoints during a confirmed deep check;
- backs up a file and checks for changes before an eligible repair;
- redacts common secret shapes in exported reports;
- has no telemetry or automatic upload service.

MCPMender cannot determine that a third-party MCP server is trustworthy. A
successful handshake means the server responded to the protocol, not that its
code, tools, output, or dependencies are safe.

Redaction is defense in depth, not a guarantee. Review every report before
sharing it and never attach raw secrets to an Issue.

## Release signatures

Beta Windows artifacts may be signed with a self-signed certificate. Such a
signature is not automatically trusted by Windows or SmartScreen and does not
prove a publicly verified publisher identity.

Beta macOS artifacts may use ad-hoc signing without notarization. Ad-hoc signing
does not establish developer identity and is not trusted by Gatekeeper.

Users should compare the artifact's SHA-256 checksum with the checksum published
alongside the release. A matching checksum detects accidental corruption or a
difference from that published artifact, but it does not independently prove
who created it.
