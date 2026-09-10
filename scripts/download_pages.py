#!/usr/bin/env python3
"""Tải 172 ảnh Atlas Việt Nam từ viewer bandovn.vn về thư mục pages/.

Chạy:
    python scripts/download_pages.py

Sau đó commit thư mục pages/ lên repo và mở GitHub Pages với:
    ?source=local
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import time
from pathlib import Path

import requests

TOTAL_PAGES = 172
BASE_URL = "https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile/{page}.jpg"
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "pages"
MANIFEST = OUT_DIR / "manifest.json"
WORKERS = 6
TIMEOUT = 30
RETRIES = 3

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/152.0 Safari/537.36"
    ),
    "Referer": "https://www.bandovn.vn/onlinescan/atlasvietnam/",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}


def md5_bytes(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def download_one(page: int) -> dict:
    url = BASE_URL.format(page=page)
    target = OUT_DIR / f"{page}.jpg"

    if target.exists() and target.stat().st_size > 10_000:
        data = target.read_bytes()
        return {
            "page": page,
            "file": target.name,
            "url": url,
            "bytes": len(data),
            "md5": md5_bytes(data),
            "status": "cached",
        }

    error = None
    for attempt in range(1, RETRIES + 1):
        try:
            response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            response.raise_for_status()

            content_type = response.headers.get("content-type", "").lower()
            data = response.content

            if "image" not in content_type and not data.startswith(b"\xff\xd8"):
                raise RuntimeError(f"Không phải ảnh JPEG: {content_type or 'unknown'}")
            if len(data) < 10_000:
                raise RuntimeError(f"File quá nhỏ: {len(data)} bytes")

            target.write_bytes(data)
            return {
                "page": page,
                "file": target.name,
                "url": url,
                "bytes": len(data),
                "md5": md5_bytes(data),
                "status": "downloaded",
            }
        except Exception as exc:  # noqa: BLE001
            error = exc
            time.sleep(attempt * 1.2)

    return {
        "page": page,
        "file": target.name,
        "url": url,
        "bytes": 0,
        "md5": None,
        "status": "failed",
        "error": str(error),
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []

    print(f"Tải {TOTAL_PAGES} trang Atlas -> {OUT_DIR}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(download_one, page): page for page in range(1, TOTAL_PAGES + 1)}

        done = 0
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            done += 1
            marker = "OK" if result["status"] != "failed" else "ERR"
            print(f"[{done:03d}/{TOTAL_PAGES}] {marker} page {result['page']:03d}  {result.get('bytes', 0):>9} bytes")

    results.sort(key=lambda item: item["page"])
    MANIFEST.write_text(
        json.dumps(
            {
                "title": "Atlas Việt Nam 1996",
                "totalPages": TOTAL_PAGES,
                "source": "https://www.bandovn.vn/onlinescan/atlasvietnam/",
                "pages": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    failed = [item for item in results if item["status"] == "failed"]
    if failed:
        print("\nCác trang lỗi:", ", ".join(str(item["page"]) for item in failed))
        raise SystemExit(1)

    print(f"\nHoàn tất: {TOTAL_PAGES}/{TOTAL_PAGES} trang")
    print(f"Manifest: {MANIFEST}")
    print("Mở website với ?source=local sau khi commit thư mục pages/.")


if __name__ == "__main__":
    main()
