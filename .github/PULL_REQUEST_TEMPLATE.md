## Summary

Describe the user problem and the focused outcome of this pull request.

## Safety and privacy

- [ ] Static `scan` remains read-only and does not execute configured commands.
- [ ] Any new command execution or network access is explicit, previewed, and
      bounded by timeout and cleanup.
- [ ] No token, private path, raw configuration, report, signing key, database,
      or generated package is included.
- [ ] Repairs, if changed, remain previewable, backed up, change-protected, and
      verifiable.
- [ ] Privacy and security documentation was updated when behavior changed.

## Validation

Commands run:

```text
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Operating systems actually tested:

- Windows:
- Linux:
- macOS Apple Silicon:
- macOS Intel:

Do not mark an untested platform as passed. Note skipped checks and why.

## User-facing changes

- [ ] English text is updated.
- [ ] Simplified Chinese text is updated.
- [ ] Japanese text is updated.
- [ ] The offline handbook is updated when commands, behavior, installation, or
      safety guidance changed.
- [ ] The changelog is updated when appropriate.
- [ ] Screenshots, if included, are current and contain no private information.

## Related Issue

Link an existing Issue when one exists. Security vulnerabilities must use the
private process in `SECURITY.md`, not a public pull request before disclosure is
coordinated.
