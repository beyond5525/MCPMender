# MCPMender signing and download verification

MCPMender (协议修匠) 0.3 beta uses different integrity mechanisms on each
platform. Read this page before running a downloaded build.

## Windows: community self-signing

The Windows portable EXE is signed with a locally created certificate whose
subject is:

```text
CN=MCPMender Community Build
```

This is a **self-signed community certificate**, not a paid, publicly trusted
code-signing certificate. It proves that the EXE has not changed since the
listed certificate signed it, and it gives users a thumbprint to compare. It
does not prove legal publisher identity to Microsoft. Windows SmartScreen,
Defender, or the “Unknown publisher” dialog may still warn about the file.

The release process creates or reuses this certificate in the current user's
personal certificate store. Its private key is marked non-exportable. Only the
public `.cer` file is included in the release. The scripts never add the
certificate to Trusted Root Certification Authorities and users should not do
that merely to silence a warning.

The release script first requests a public timestamp. If the timestamp service
is unavailable, it prints a warning and creates the SHA-256 Authenticode
signature without a timestamp. An untimestamped signature can no longer be
considered current after its signing certificate expires, so check the
certificate dates shown below.

To inspect the EXE in PowerShell:

```powershell
$signature = Get-AuthenticodeSignature .\MCPMender-0.3.0-beta.1-Windows-x64.exe
$signature | Select-Object Status, StatusMessage
$signature.SignerCertificate | Select-Object Subject, Thumbprint, NotBefore, NotAfter
```

`SignerCertificate` must be present, its subject must be
`CN=MCPMender Community Build`, and its thumbprint must match the thumbprint
published with that release. Because the certificate is self-signed, `Status`
can be `NotTrusted` even when the signature is intact. Do not treat
`NotTrusted` as “unsigned.”

The same value is recorded in
`Certificates\MCPMender-Community-Build.thumbprint.txt`. Compare it with a
thumbprint announced separately on the project's release page as well as with
the EXE and `.cer` values.

You can also inspect the included public certificate:

```powershell
Get-PfxCertificate .\Certificates\MCPMender-Community-Build.cer |
  Select-Object Subject, Thumbprint, NotBefore, NotAfter
```

If the EXE signer thumbprint and public certificate thumbprint differ, do not
run the file.

## SHA-256 checksums on every platform

`SHA256SUMS.txt` lists every file in the release folder except the checksum
manifest itself. On Windows, compare one file with:

```powershell
Get-FileHash .\MCPMender-0.3.0-beta.1-Windows-x64.exe -Algorithm SHA256
```

On macOS or Linux:

```sh
shasum -a 256 MCPMender-0.3.0-beta.1-*
```

Compare the complete 64-character hash with `SHA256SUMS.txt`. A mismatch means
the file is damaged or altered; do not run it.

## macOS: ad-hoc signing

The macOS beta is ad-hoc signed (`codesign` identity `-`). Ad-hoc signing
preserves the app bundle's code-signature structure, but it provides no
Developer ID identity and no Apple notarization. Gatekeeper can therefore block
or warn about the app. The release does not ask users to weaken global macOS
security settings.

On a Mac, verify the bundle after extracting it:

```sh
codesign --verify --deep --strict --verbose=2 MCPMender.app
codesign -dv --verbose=4 MCPMender.app
```

Also verify the downloaded DMG or ZIP against `SHA256SUMS.txt`.

## Linux: checksums

Linux AppImage and tar.gz files are not Authenticode- or Apple-signed. Verify
their SHA-256 values against `SHA256SUMS.txt` before use. Distribution package
signing may be added after the beta, but it is not claimed for version
0.3.0-beta.1.

## Release maintainer command

From `H:\MCPulse`, the local release script builds, signs, checksums, packages,
and verifies the release:

```powershell
.\tools\package-release.ps1
```

The final folder is `H:\MCPulse\release\MCPMender` and the upload archive is
`H:\MCPulse\release\MCPMender.zip`. The folder name intentionally has no
version number.
