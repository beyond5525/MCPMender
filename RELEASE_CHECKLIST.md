# MCPMender Release Checklist

Use this checklist for every public MCPMender（协议修匠）release. Record facts,
not assumptions. An unchecked item is a known release limitation and must be
disclosed in the release notes.

## 1. Scope and version

- [ ] Version is consistent in the workspace, Desktop, CLI, handbook, and
      changelog.
- [ ] A beta is labeled `beta` in the version, application, artifacts, and
      release notes.
- [ ] `CHANGELOG.md` describes user-visible changes and known limitations.
- [ ] The Git working tree contains only intended release changes.
- [ ] Staged files were checked for tokens, private reports, certificates,
      signing keys, databases, test archives, and local configuration.
- [ ] The release commit and tag identify the exact source used for artifacts.

## 2. Quality gates

- [ ] Dependency installation succeeds from the lockfile.
- [ ] Unit and integration tests pass.
- [ ] Type checking passes.
- [ ] Production builds pass.
- [ ] `git diff --check` passes.
- [ ] Static scan tests prove that configured commands are not started.
- [ ] Deep-check tests cover stdio, Streamable HTTP, timeout, authentication
      failure, tool-list behavior, and process/session cleanup.
- [ ] Repair tests cover preview, backup, changed-file refusal, verification,
      and rollback.
- [ ] Report tests cover redaction of environment values, headers, URLs, and
      command arguments.
- [ ] The offline handbook test proves that no external asset is loaded.

## 3. Native platform validation

For each platform, record the operating-system version and artifact name.

### Windows x64

- [ ] Built on Windows.
- [ ] Portable app starts and closes without a residual process.
- [ ] English, Simplified Chinese, and Japanese render correctly.
- [ ] Scan, project-folder selection, deep-check preview, confirmed test-server
      probe, report export, safe repair, and rollback were exercised.
- [ ] Self-signed signature status and SmartScreen behavior were recorded.

### Linux x64

- [ ] Built on Linux.
- [ ] AppImage starts on a supported Linux desktop.
- [ ] tar.gz executable starts on a supported Linux desktop.
- [ ] Language, scan, project selection, test-server probe, report export,
      repair, rollback, and process cleanup were exercised.
- [ ] Required shared libraries and any tested distributions were recorded.

### macOS Apple Silicon

- [ ] Built and started on Apple Silicon macOS.
- [ ] DMG/ZIP, install/open, language, permissions, scan, project selection,
      test-server probe, report export, repair, rollback, and cleanup were
      exercised.
- [ ] Ad-hoc signature, quarantine, Gatekeeper, and notarization status were
      recorded.

### macOS Intel

- [ ] Built and started on Intel macOS.
- [ ] DMG/ZIP, install/open, language, permissions, scan, project selection,
      test-server probe, report export, repair, rollback, and cleanup were
      exercised.
- [ ] Ad-hoc signature, quarantine, Gatekeeper, and notarization status were
      recorded.

### CLI

- [ ] Packed tarball installs in a clean Node.js 20+ environment.
- [ ] `mcpmender --version` and `mcpmender --help` pass.
- [ ] `scan`, `scan --json`, `probe`, controlled `probe --run`, `repair`, and
      all three languages pass on Windows, Linux, and macOS.
- [ ] Exit codes for success, findings, authentication failure, and connection
      failure are documented and tested.

## 4. Privacy, security, and dependencies

- [ ] Production dependency audit was reviewed and every unresolved finding is
      fixed or documented with impact and rationale.
- [ ] Electron and other security-sensitive runtimes remain supported upstream.
- [ ] No telemetry or automatic upload was introduced.
- [ ] Network behavior matches `PRIVACY.md`.
- [ ] Deep checks still require explicit action and show an execution preview.
- [ ] `SECURITY.md` private reporting instructions are available.
- [ ] License and third-party notices are present in source and packaged apps.
- [ ] An SBOM is generated for release artifacts.

## 5. Artifact integrity and signing

- [ ] Artifacts come from the tagged source and native build jobs.
- [ ] Artifact contents and executable names use MCPMender, not the former name.
- [ ] Windows signing uses only the intended release certificate.
- [ ] No private certificate key or password is included in source or artifacts.
- [ ] Release notes state that a self-signed Windows certificate is not trusted
      automatically by Windows or SmartScreen.
- [ ] macOS artifacts are ad-hoc signed or formally signed as declared.
- [ ] Release notes state that ad-hoc signing does not establish developer
      identity and is not trusted by Gatekeeper.
- [ ] SHA-256 checksums were generated after final packaging.
- [ ] Checksums were verified after downloading the uploaded artifacts.

## 6. Documentation and release presentation

- [ ] README installation and commands match the release.
- [ ] English, Simplified Chinese, and Japanese handbook content matches.
- [ ] Screenshots contain the release UI and no private information.
- [ ] Release notes distinguish automated, native, and manual validation.
- [ ] Known limitations and unsigned/untrusted-signature warnings are prominent.
- [ ] Upgrade, uninstall, backup, and rollback guidance is accurate.
- [ ] Issue and pull-request templates are present.

## 7. Publish and post-release

- [ ] Final release archive contains one versionless `MCPMender` folder with the
      intended client and documentation.
- [ ] The versionless folder archive was extracted and smoke-tested separately.
- [ ] Release artifacts, checksums, SBOM, source archive, and release notes were
      uploaded.
- [ ] npm package metadata and tarball were inspected before publication.
- [ ] npm beta publication installs and runs from the public registry.
- [ ] GitHub Release is marked pre-release for beta versions.
- [ ] Uploaded checksums match locally retained final artifacts.
- [ ] A clean machine can follow the published quick start.
- [ ] Security advisories and Issues are monitored after release.

## Release decision

- Decision: [ ] Ship beta  [ ] Hold
- Release version:
- Release commit/tag:
- Date:
- Platforms actually validated:
- Validation intentionally skipped:
- Known limitations disclosed:
- Approver:
