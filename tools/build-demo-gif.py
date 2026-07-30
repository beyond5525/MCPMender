from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCREENSHOT = ROOT / "docs" / "screenshots" / "en-main.png"
DEFAULT_OUTPUT = ROOT / "docs" / "marketing" / "mcpmender-demo.gif"
FRAME_SIZE = (960, 635)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/seguisb.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def scaled_rect(rect: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    scale_x = FRAME_SIZE[0] / 1180
    scale_y = FRAME_SIZE[1] / 780
    return tuple(
        round(value * (scale_x if index % 2 == 0 else scale_y))
        for index, value in enumerate(rect)
    )


def add_focus(
    base: Image.Image,
    rects: list[tuple[int, int, int, int]],
    step: str,
    title: str,
    detail: str,
) -> Image.Image:
    frame = base.convert("RGBA")
    shade = Image.new("RGBA", frame.size, (2, 10, 22, 135))
    shade_draw = ImageDraw.Draw(shade)
    for rect in rects:
        shade_draw.rounded_rectangle(
            scaled_rect(rect),
            radius=12,
            fill=(0, 0, 0, 0),
            outline=(77, 237, 204, 255),
            width=4,
        )
    frame = Image.alpha_composite(frame, shade)
    draw = ImageDraw.Draw(frame)
    panel = (34, 34, 730, 130)
    draw.rounded_rectangle(panel, radius=18, fill=(6, 20, 38, 235), outline=(71, 229, 204, 210), width=2)
    draw.rounded_rectangle((53, 54, 124, 108), radius=14, fill=(71, 229, 204, 255))
    draw.text((73, 65), step, font=load_font(26, True), fill=(4, 26, 40))
    draw.text((145, 49), title, font=load_font(28, True), fill=(246, 249, 255))
    draw.text((146, 88), detail, font=load_font(17), fill=(174, 198, 222))
    return frame.convert("RGB")


def add_intro(base: Image.Image) -> Image.Image:
    frame = base.convert("RGBA")
    overlay = Image.new("RGBA", frame.size, (2, 10, 22, 205))
    frame = Image.alpha_composite(frame, overlay)
    draw = ImageDraw.Draw(frame)
    draw.rounded_rectangle((66, 105, 894, 518), radius=26, fill=(7, 25, 45, 238), outline=(45, 130, 163, 210), width=2)
    draw.text((105, 158), "MCP server not working?", font=load_font(45, True), fill=(246, 249, 255))
    draw.text((105, 230), "Find the problem.", font=load_font(34, True), fill=(174, 198, 222))
    draw.text((105, 282), "Repair it safely.", font=load_font(34, True), fill=(71, 229, 204))
    draw.text((105, 365), "MCPMender · Desktop + CLI · Local only", font=load_font(21), fill=(204, 222, 239))
    draw.text((105, 420), "Windows · macOS · Linux", font=load_font(19, True), fill=(119, 226, 211))
    return frame.convert("RGB")


def add_outro(base: Image.Image) -> Image.Image:
    frame = base.convert("RGBA")
    overlay = Image.new("RGBA", frame.size, (2, 10, 22, 185))
    frame = Image.alpha_composite(frame, overlay)
    draw = ImageDraw.Draw(frame)
    draw.rounded_rectangle((60, 105, 900, 530), radius=26, fill=(7, 25, 45, 242), outline=(71, 229, 204, 220), width=2)
    draw.text((105, 154), "Preview → backup → repair → rollback", font=load_font(34, True), fill=(246, 249, 255))
    draw.text((105, 229), "Static scans do not run configured MCP code.", font=load_font(22), fill=(174, 198, 222))
    draw.text((105, 277), "Live checks and changes always require an explicit action.", font=load_font(22), fill=(174, 198, 222))
    draw.rounded_rectangle((105, 365, 590, 430), radius=16, fill=(71, 229, 204, 255))
    draw.text((135, 381), "github.com/beyond5525/MCPMender", font=load_font(20, True), fill=(4, 26, 40))
    return frame.convert("RGB")


def quantize(frame: Image.Image) -> Image.Image:
    return frame.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)


def build_demo(screenshot_path: Path, output_path: Path) -> None:
    screenshot = Image.open(screenshot_path).convert("RGB")
    base = screenshot.resize(FRAME_SIZE, Image.Resampling.LANCZOS)
    frames = [
        add_intro(base),
        add_focus(
            base,
            [(856, 109, 958, 161)],
            "1",
            "Run a read-only scan",
            "Discover supported MCP client configurations without starting servers.",
        ),
        add_focus(
            base,
            [(585, 446, 860, 570), (28, 680, 1140, 778)],
            "2",
            "See the exact problem",
            "MCPMender explains missing commands, syntax errors, variables, and URLs.",
        ),
        add_focus(
            base,
            [(865, 446, 1142, 570), (990, 158, 1142, 211)],
            "3",
            "Preview eligible safe repairs",
            "Review the change first. Applied repairs create backups and rollback records.",
        ),
        add_outro(base),
    ]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    paletted = [quantize(frame) for frame in frames]
    paletted[0].save(
        output_path,
        save_all=True,
        append_images=paletted[1:],
        duration=[4000] * len(paletted),
        loop=0,
        optimize=True,
        disposal=2,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the MCPMender 20-second product demo GIF.")
    parser.add_argument("--screenshot", type=Path, default=DEFAULT_SCREENSHOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not args.screenshot.is_file():
        raise SystemExit(f"Screenshot is missing: {args.screenshot}")
    build_demo(args.screenshot.resolve(), args.output.resolve())
    size = args.output.stat().st_size
    print(f"Built demo GIF: {args.output.resolve()} ({size} bytes)")


if __name__ == "__main__":
    main()
