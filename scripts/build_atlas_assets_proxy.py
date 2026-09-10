#!/usr/bin/env python3
"""Build Vietflexmap Atlas assets through a public image cache proxy.

This is a fallback for environments where bandovn.vn is unreachable from
GitHub-hosted runners. wsrv.nl fetches the public page image at the origin and
returns a cached image. The generated website itself never depends on wsrv.nl:
all 172 pages and the PDF are committed into this repository.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import io
import json
import shutil
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

import img2pdf
import requests
from PIL import Image, ImageOps

TOTAL_PAGES = 172
SOURCE_VIEWER = "https://www.bandovn.vn/onlinescan/atlasvietnam/"
SOURCE_PATTERN = SOURCE_VIEWER + "files/mobile/{page}.jpg"
PROXY_BASE = "https://wsrv.nl/?url={url}"
ROOT = Path(__file__).resolve().parents[1]
PAGES_DIR = ROOT / "pages"
MANIFEST = PAGES_DIR / "manifest.json"
PDF_PATH = ROOT / "Atlas_Vietnam_1996.pdf"
WORKERS = 8
TIMEOUT = 35
RETRIES = 4
MIN_BYTES = 8_000
MAX_PDF_BYTES = 92 * 1024 * 1024

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Vietflexmap Atlas Digitizer/1.0)",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}


def origin_url(page: int) -> str:
    return SOURCE_PATTERN.format(page=page)


def proxy_url(page: int) -> str:
    return PROXY_BASE.format(url=quote(origin_url(page), safe=""))


def validate(data: bytes, page: int) -> tuple[int, int, str]:
    if len(data) < MIN_BYTES:
        raise RuntimeError(f"page {page}: response too small ({len(data)} bytes)")
    try:
        with Image.open(io.BytesIO(data)) as image:
            fmt = image.format or "UNKNOWN"
            width, height = image.size
            image.verify()
    except Exception as exc:
        raise RuntimeError(f"page {page}: invalid image ({exc})") from exc
    if width < 300 or height < 300:
        raise RuntimeError(f"page {page}: suspicious dimensions {width}x{height}")
    return width, height, fmt


def download_page(page: int) -> dict:
    target = PAGES_DIR / f"{page}.jpg"
    if target.exists() and target.stat().st_size >= MIN_BYTES:
        try:
            data = target.read_bytes()
            width, height, fmt = validate(data, page)
            return {
                "page": page, "file": target.name, "origin": origin_url(page),
                "retrievedVia": "local-cache", "bytes": len(data),
                "width": width, "height": height, "format": fmt,
                "sha256": hashlib.sha256(data).hexdigest(), "status": "cached",
            }
        except Exception:
            target.unlink(missing_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)
    error = None
    url = proxy_url(page)

    for attempt in range(1, RETRIES + 1):
        try:
            response = session.get(url, timeout=TIMEOUT, allow_redirects=True)
            response.raise_for_status()
            data = response.content
            width, height, fmt = validate(data, page)

            # Normalize whatever the proxy returns into a stable JPEG file.
            with Image.open(io.BytesIO(data)) as image:
                image = ImageOps.exif_transpose(image).convert("RGB")
                buffer = io.BytesIO()
                image.save(buffer, "JPEG", quality=96, subsampling=0, optimize=True)
                jpeg = buffer.getvalue()

            width, height, fmt = validate(jpeg, page)
            target.write_bytes(jpeg)
            return {
                "page": page, "file": target.name, "origin": origin_url(page),
                "retrievedVia": url, "bytes": len(jpeg),
                "width": width, "height": height, "format": "JPEG",
                "sha256": hashlib.sha256(jpeg).hexdigest(), "status": "downloaded",
            }
        except Exception as exc:  # noqa: BLE001
            error = exc
            time.sleep(min(6, attempt * 1.25))

    return {
        "page": page, "file": target.name, "origin": origin_url(page),
        "retrievedVia": url, "bytes": 0, "status": "failed", "error": str(error),
    }


def probe() -> None:
    print("Testing CDN image proxy with Atlas page 1...", flush=True)
    result = download_page(1)
    if result["status"] == "failed":
        raise RuntimeError(f"CDN proxy could not retrieve page 1: {result.get('error')}")
    print(
        f"Proxy OK: page 1, {result['width']}x{result['height']}, "
        f"{result['bytes'] / 1024:.0f} KiB",
        flush=True,
    )


def download_all() -> list[dict]:
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    probe()
    results: list[dict] = []
    print(f"Downloading {TOTAL_PAGES} pages via CDN proxy...", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(download_page, page): page for page in range(1, TOTAL_PAGES + 1)}
        for done, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            item = future.result()
            results.append(item)
            marker = "OK" if item["status"] != "failed" else "ERR"
            print(
                f"[{done:03d}/{TOTAL_PAGES}] {marker} page {item['page']:03d} "
                f"{item.get('bytes', 0):>9} bytes",
                flush=True,
            )

    results.sort(key=lambda item: item["page"])
    failed = [item for item in results if item["status"] == "failed"]
    if failed:
        detail = "; ".join(f"{x['page']}: {x.get('error', '')}" for x in failed)
        raise RuntimeError("Failed pages: " + detail)
    return results


def write_manifest(results: list[dict]) -> None:
    MANIFEST.write_text(
        json.dumps({
            "title": "Atlas Việt Nam 1996",
            "credit": "Nguồn: Vietflexmap số hóa",
            "sourceViewer": SOURCE_VIEWER,
            "retrievalMode": "wsrv.nl cache proxy",
            "totalPages": TOTAL_PAGES,
            "generatedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "pages": results,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def page_files() -> list[Path]:
    files = [PAGES_DIR / f"{page}.jpg" for page in range(1, TOTAL_PAGES + 1)]
    missing = [str(path) for path in files if not path.exists()]
    if missing:
        raise RuntimeError("Missing pages: " + ", ".join(missing[:20]))
    return files


def make_pdf(files: list[Path], output: Path) -> None:
    with output.open("wb") as stream:
        stream.write(img2pdf.convert([str(path) for path in files]))


def optimized_pdf(files: list[Path]) -> None:
    attempts = [(90, 2600), (84, 2300), (78, 2100), (72, 1900), (66, 1700)]
    temp_pdf = PDF_PATH.with_suffix(".tmp.pdf")

    with tempfile.TemporaryDirectory(prefix="atlas-pdf-") as temp:
        temp_root = Path(temp)
        for quality, max_side in attempts:
            image_dir = temp_root / f"q{quality}-{max_side}"
            image_dir.mkdir()
            optimized: list[Path] = []
            for page, source in enumerate(files, start=1):
                destination = image_dir / f"{page}.jpg"
                with Image.open(source) as image:
                    image = ImageOps.exif_transpose(image).convert("RGB")
                    width, height = image.size
                    factor = min(1.0, max_side / max(width, height))
                    if factor < 1.0:
                        image = image.resize(
                            (round(width * factor), round(height * factor)),
                            Image.Resampling.LANCZOS,
                        )
                    image.save(destination, "JPEG", quality=quality, optimize=True)
                optimized.append(destination)

            make_pdf(optimized, temp_pdf)
            size = temp_pdf.stat().st_size
            print(f"PDF q={quality}, max={max_side}: {size / 1024 / 1024:.1f} MB", flush=True)
            if size <= MAX_PDF_BYTES:
                temp_pdf.replace(PDF_PATH)
                return
            temp_pdf.unlink(missing_ok=True)
            shutil.rmtree(image_dir, ignore_errors=True)

    raise RuntimeError("Could not create a PDF small enough for a normal GitHub repository file")


def build_pdf() -> None:
    files = page_files()
    temp_pdf = PDF_PATH.with_suffix(".tmp.pdf")
    make_pdf(files, temp_pdf)
    size = temp_pdf.stat().st_size
    print(f"PDF from local pages: {size / 1024 / 1024:.1f} MB", flush=True)
    if size <= MAX_PDF_BYTES:
        temp_pdf.replace(PDF_PATH)
    else:
        temp_pdf.unlink(missing_ok=True)
        optimized_pdf(files)


def main() -> None:
    results = download_all()
    if len(results) != TOTAL_PAGES:
        raise RuntimeError(f"Expected {TOTAL_PAGES} pages, got {len(results)}")
    write_manifest(results)
    build_pdf()
    if not PDF_PATH.exists() or PDF_PATH.stat().st_size < 1_000_000:
        raise RuntimeError("Atlas_Vietnam_1996.pdf was not generated correctly")
    print(f"DONE: {TOTAL_PAGES}/172 pages", flush=True)
    print(f"PDF: {PDF_PATH.stat().st_size / 1024 / 1024:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
