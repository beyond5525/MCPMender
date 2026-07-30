# MCPMender marketing assets

`social-preview-background.png` was generated with OpenAI's built-in image
generation tool for this project. It contains no third-party logos, screenshots,
people, or text.

`mcpmender-social-preview.jpg` combines that generated background with the
project-owned MCPMender logo and deterministic text rendered by
`tools/build-social-preview.ps1`.

`mcpmender-demo.gif` is a 20-second, five-frame walkthrough generated from the
privacy-safe English product screenshot by `tools/build-demo-gif.py`. It does
not execute or change an MCP configuration.

Rebuild the final 1280×640 GitHub social preview on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\build-social-preview.ps1
```

Rebuild the animated walkthrough with the Pillow dependency installed under the
project's external tool environment:

```powershell
F:\GemeHuanJing\Python311\python.exe .\tools\build-demo-gif.py
```
