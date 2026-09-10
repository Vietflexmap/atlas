#!/usr/bin/env python3
"""Build local Atlas assets for Vietflexmap/atlas.

Primary source is the public HTML5 viewer at bandovn.vn. If that server is not
reachable from GitHub Actions, the builder falls back to Internet Archive's
Wayback Machine for archived copies of the same public page-image URLs.
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
import urllib3
from PIL import Image, ImageOps

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TOTAL_PAGES = 172
SOURCE_VIEWER = "https://www.bandovn.vn/onlinescan/atlasvietnam/"
DIRECT_PATTERNS = [
    "https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile/{page}.jpg",
    "http://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile/{page}.jpg",
]
WAYBACK_AVAILABLE = "https://archive.org/wayback/available"
ROOT = Path(__file__).resolve().parents[1]
PAGES_DIR = ROOT / "pages"
MANIFEST = PAGES_DIR / "manifest.json"
PDF_PATH = ROOT / "Atlas_Vietnam_1996.pdf"
WORKERS = 10
TIMEOUT = 20
RETRIES = 3
MIN_BYTES = 8_000
MAX_PDF_BYTES = 92 * 1024 * 1024

SOURCE_MODE = "direct"
ACTIVE_PATTERN = DIRECT_PATTERNS[0]
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


def original_urls(page: int) -> list[str]:
    return [pattern.format(page=page) for pattern in DIRECT_PATTERNS]


def wayback_url_for(original: str, session: requests.Session) -> str | None:
    """Return raw Wayback replay URL for the closest archived capture."""
    response = session.get(
        WAYBACK_AVAILABLE,
        params={"url": original},
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    closest = payload.get("archived_snapshots", {}).get("closest")
    if not closest or not closest.get("available") or str(closest.get("status")) != "200":
        return None
    timestamp = closest.get("timestamp")
    if not timestamp:
        return None
    # id_ asks Wayback for the archived original bytes, without replay rewriting.
    return f"https://web.archive.org/web/{timestamp}id_/{original}"


def fetch_wayback_page(page: int, session: requests.Session) -> tuple[bytes, str]:
    errors: list[str] = []
    for original in original_urls(page):
        try:
            archived = wayback_url_for(original, session)
            if not archived:
                errors.append(f"no archived capture for {original}")
                continue
            response = session.get(archived, timeout=TIMEOUT, allow_redirects=True)
            response.raise_for_status()
            validate_image(response.content, page)
            return response.content, archived
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{original}: {exc}")
    raise RuntimeError("; ".join(errors))


def probe_source() -> None:
    global SOURCE_MODE, ACTIVE_PATTERN, ACTIVE_VERIFY
    session = requests.Session()
    session.headers.update(HEADERS)

    print("Probing live Atlas source...", flush=True)
    for pattern in DIRECT_PATTERNS:
        url = pattern.format(page=1)
        for verify in ([True, False] if url.startswith("https://") else [True]):
            try:
                response = session.get(url, timeout=5, allow_redirects=True, verify=verify)
                response.raise_for_status()
                validate_image(response.content, 1)
                SOURCE_MODE = "direct"
                ACTIVE_PATTERN = pattern
                ACTIVE_VERIFY = verify
                print(f"Live source OK: {url}", flush=True)
                return
            except Exception as exc:  # noqa: BLE001
                print(f"Live source unavailable: {url}: {exc}", flush=True)

    print("Live server is unreachable. Probing Internet Archive...", flush=True)
    data, archived = fetch_wayback_page(1, session)
    validate_image(data, 1)
    SOURCE_MODE = "wayback"
    ACTIVE_PATTERN = archived
    ACTIVE_VERIFY = True
    print(f"Wayback fallback OK: {archived}", flush=True)


def download_page(page: int) -> dict:
    target = PAGES_DIR / f"{page}.jpg"

    if target.exists() and target.stat().st_size >= MIN_BYTES:
        try:
            data = target.read_bytes()
            width, height = validate_image(data, page)
            return {
                "page": page,
                "file": target.name,
                "bytes": len(data),
                "width": width,
                "height": height,
                "sha256": digest(data),
                "status": "cached",
            }
        except Exception:
            target.unlink(missing_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)
    error: Exception | None = None

    for attempt in range(1, RETRIES + 1):
        try:
            if SOURCE_MODE == "wayback":
                data, resolved_url = fetch_wayback_page(page, session)
            else:
                resolved_url = ACTIVE_PATTERN.format(page=page)
                response = session.get(
                    resolved_url,
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
                "source": resolved_url,
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
        "bytes": 0,
        "status": "failed",
        "error": str(error),
    }


def download_all() -> list[dict]:
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    probe_source()
    print(f"Source mode: {SOURCE_MODE}", flush=True)
    print(f"Downloading {TOTAL_PAGES} pages with {WORKERS} workers", flush=True)
    results: list[dict] = []

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
                "retrievalMode": SOURCE_MODE,
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
    print(f"Lossless image PDF: {size / 1024 / 1024:.1f} MB", flush=True)

    if size <= MAX_PDF_BYTES:
        temp_pdf.replace(PDF_PATH)
        return

    temp_pdf.unlink(missing_ok=True)
    attempts = [(88, 2600), (82, 2300), (76, 2100), (70, 1900), (64, 1700)]
    with tempfile.TemporaryDirectory(prefix="atlas-pdf-") as temp:
        root = Path(temp)
        for quality, max_side in attempts:
            work = root / f"q{quality}_{max_side}"
            optimized = optimize_pages_for_pdf(files, quality, max_side, work)
            make_pdf_from_jpegs(optimized, temp_pdf)
            size = temp_pdf.stat().st_size
            print(f"Optimized q={quality}, max={max_side}: {size / 1024 / 1024:.1f} MB", flush=True)
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
    print("Build complete", flush=True)
    print(f"Pages: {TOTAL_PAGES}/{TOTAL_PAGES}", flush=True)
    print(f"PDF: {PDF_PATH.name} ({PDF_PATH.stat().st_size / 1024 / 1024:.1f} MB)", flush=True)


def main() -> None:
    results = download_all()
    write_manifest(results)
    build_pdf()
    verify_final(results)


if __name__ == "__main__":
    main()
