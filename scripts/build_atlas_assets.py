#!/usr/bin/env python3
"""Build local Atlas assets for Vietflexmap/atlas.

Downloads 172 page images from the source viewer, validates every page, writes
pages/manifest.json and creates Atlas_Vietnam_1996.pdf. The published HTML5
Flipbook reads local pages/*.jpg, so normal readers do not hotlink the source.
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

import img2pdf
import requests
import urllib3
from PIL import Image, ImageOps

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TOTAL_PAGES = 172
SOURCE_VIEWER = "https://www.bandovn.vn/onlinescan/atlasvietnam/"
SOURCE_CANDIDATES = [
    "https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile/{page}.jpg",
    "https://bandovn.vn/onlinescan/atlasvietnam/files/mobile/{page}.jpg",
    "http://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile/{page}.jpg",
]
ROOT = Path(__file__).resolve().parents[1]
PAGES_DIR = ROOT / "pages"
MANIFEST = PAGES_DIR / "manifest.json"
PDF_PATH = ROOT / "Atlas_Vietnam_1996.pdf"
WORKERS = 10
TIMEOUT = 20
RETRIES = 3
MIN_BYTES = 8_000
MAX_PDF_BYTES = 92 * 1024 * 1024
ACTIVE_PATTERN = SOURCE_CANDIDATES[0]
ACTIVE_VERIFY = True

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/152.0 Safari/537.36"
    ),
    "Referer": SOURCE_VIEWER,
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_image(data: bytes, page: int) -> tuple[int, int]:
    if len(data) < MIN_BYTES:
        raise RuntimeError(f"page {page}: file too small ({len(data)} bytes)")
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
    except Exception as exc:
        raise RuntimeError(f"page {page}: invalid image: {exc}") from exc
    if width < 300 or height < 300:
        raise RuntimeError(f"page {page}: suspicious dimensions {width}x{height}")
    return width, height


def probe_source() -> tuple[str, bool]:
    """Find one reachable source URL before spawning 172 downloads."""
    print("Probing Atlas image source...")
    session = requests.Session()
    session.headers.update(HEADERS)

    attempts: list[tuple[str, bool]] = []
    for pattern in SOURCE_CANDIDATES:
        attempts.append((pattern, True))
        if pattern.startswith("https://"):
            attempts.append((pattern, False))

    errors: list[str] = []
    for pattern, verify in attempts:
        url = pattern.format(page=1)
        try:
            response = session.get(url, timeout=10, allow_redirects=True, verify=verify)
            response.raise_for_status()
            validate_image(response.content, 1)
            print(f"Source OK: {url} (TLS verify={verify})")
            return pattern, verify
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{url} verify={verify}: {exc}")
            print(f"Source probe failed: {url} verify={verify}: {exc}")

    raise RuntimeError("No reachable Atlas image source.\n" + "\n".join(errors))


def download_page(page: int) -> dict:
    url = ACTIVE_PATTERN.format(page=page)
    target = PAGES_DIR / f"{page}.jpg"

    if target.exists() and target.stat().st_size >= MIN_BYTES:
        try:
            data = target.read_bytes()
            width, height = validate_image(data, page)
            return {
                "page": page,
                "file": target.name,
                "source": url,
                "bytes": len(data),
                "width": width,
                "height": height,
                "sha256": digest(data),
                "status": "cached",
            }
        except Exception:
            target.unlink(missing_ok=True)

    error: Exception | None = None
    session = requests.Session()
    session.headers.update(HEADERS)

    for attempt in range(1, RETRIES + 1):
        try:
            response = session.get(
                url,
                timeout=TIMEOUT,
                allow_redirects=True,
                verify=ACTIVE_VERIFY,
            )
            response.raise_for_status()
            data = response.content
            width, height = validate_image(data, page)
            target.write_bytes(data)
            return {
                "page": page,
                "file": target.name,
                "source": url,
                "bytes": len(data),
                "width": width,
                "height": height,
                "sha256": digest(data),
                "status": "downloaded",
            }
        except Exception as exc:  # noqa: BLE001
            error = exc
            time.sleep(attempt)

    return {
        "page": page,
        "file": target.name,
        "source": url,
        "bytes": 0,
        "status": "failed",
        "error": str(error),
    }


def download_all() -> list[dict]:
    global ACTIVE_PATTERN, ACTIVE_VERIFY
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    ACTIVE_PATTERN, ACTIVE_VERIFY = probe_source()
    results: list[dict] = []

    print(f"Downloading {TOTAL_PAGES} Atlas pages with {WORKERS} workers")
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(download_page, page): page for page in range(1, TOTAL_PAGES + 1)}
        for done, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            marker = "OK" if result["status"] != "failed" else "ERR"
            print(
                f"[{done:03d}/{TOTAL_PAGES}] {marker} page {result['page']:03d} "
                f"{result.get('bytes', 0):>9} bytes",
                flush=True,
            )

    results.sort(key=lambda item: item["page"])
    failed = [item for item in results if item["status"] == "failed"]
    if failed:
        details = "; ".join(f"{item['page']}: {item.get('error', '')}" for item in failed)
        raise RuntimeError("Failed pages: " + details)
    return results


def write_manifest(results: list[dict]) -> None:
    MANIFEST.write_text(
        json.dumps(
            {
                "title": "Atlas Việt Nam 1996",
                "credit": "Nguồn: Vietflexmap số hóa",
                "sourceViewer": SOURCE_VIEWER,
                "resolvedImagePattern": ACTIVE_PATTERN,
                "totalPages": TOTAL_PAGES,
                "generatedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "pages": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def page_files() -> list[Path]:
    files = [PAGES_DIR / f"{page}.jpg" for page in range(1, TOTAL_PAGES + 1)]
    missing = [str(path) for path in files if not path.exists()]
    if missing:
        raise RuntimeError("Missing local pages: " + ", ".join(missing[:10]))
    return files


def make_pdf_from_jpegs(files: list[Path], output: Path) -> None:
    with output.open("wb") as stream:
        stream.write(img2pdf.convert([str(path) for path in files]))


def optimize_pages_for_pdf(files: list[Path], quality: int, max_side: int, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    optimized: list[Path] = []
    for index, source in enumerate(files, start=1):
        destination = output_dir / f"{index}.jpg"
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            width, height = image.size
            scale = min(1.0, max_side / max(width, height))
            if scale < 1.0:
                image = image.resize(
                    (max(1, round(width * scale)), max(1, round(height * scale))),
                    Image.Resampling.LANCZOS,
                )
            image.save(destination, "JPEG", quality=quality, optimize=True, progressive=False)
        optimized.append(destination)
    return optimized


def build_pdf() -> None:
    files = page_files()
    temp_pdf = PDF_PATH.with_suffix(".tmp.pdf")
    make_pdf_from_jpegs(files, temp_pdf)
    size = temp_pdf.stat().st_size
    print(f"Lossless image PDF: {size / 1024 / 1024:.1f} MB")

    if size <= MAX_PDF_BYTES:
        temp_pdf.replace(PDF_PATH)
        return

    temp_pdf.unlink(missing_ok=True)
    print("PDF exceeds safe GitHub size; making a high-quality optimized PDF.")
    attempts = [(88, 2600), (82, 2300), (76, 2100), (70, 1900), (64, 1700)]
    with tempfile.TemporaryDirectory(prefix="atlas-pdf-") as temp:
        root = Path(temp)
        for quality, max_side in attempts:
            work = root / f"q{quality}_{max_side}"
            optimized = optimize_pages_for_pdf(files, quality, max_side, work)
            make_pdf_from_jpegs(optimized, temp_pdf)
            size = temp_pdf.stat().st_size
            print(f"Optimized q={quality}, max={max_side}: {size / 1024 / 1024:.1f} MB")
            if size <= MAX_PDF_BYTES:
                temp_pdf.replace(PDF_PATH)
                return
            temp_pdf.unlink(missing_ok=True)
            shutil.rmtree(work, ignore_errors=True)

    raise RuntimeError("Unable to keep Atlas_Vietnam_1996.pdf below GitHub's file-size limit")


def verify_final(results: list[dict]) -> None:
    if len(results) != TOTAL_PAGES:
        raise RuntimeError(f"Expected {TOTAL_PAGES} pages, got {len(results)}")
    if not PDF_PATH.exists() or PDF_PATH.stat().st_size < 1_000_000:
        raise RuntimeError("Final PDF was not created correctly")
    print("\nBuild complete")
    print(f"Pages: {TOTAL_PAGES}/{TOTAL_PAGES}")
    print(f"PDF: {PDF_PATH.name} ({PDF_PATH.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"Manifest: {MANIFEST.relative_to(ROOT)}")


def main() -> None:
    results = download_all()
    write_manifest(results)
    build_pdf()
    verify_final(results)


if __name__ == "__main__":
    main()
