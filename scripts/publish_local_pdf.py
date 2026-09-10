#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate and publish a local 172-page Atlas PDF into this repository.

Usage:
    python scripts/publish_local_pdf.py "C:\\path\\atlas.pdf"
    python scripts/publish_local_pdf.py "C:\\path\\atlas.pdf" --push
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from pypdf import PdfReader

EXPECTED_PAGES = 172
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "Atlas_Vietnam_1996.pdf"


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish Atlas Việt Nam 1996 PDF for the HTML5 Flipbook")
    parser.add_argument("pdf", type=Path, help="Đường dẫn PDF nguồn")
    parser.add_argument("--push", action="store_true", help="Commit và push lên nhánh main")
    args = parser.parse_args()

    source = args.pdf.expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"Không tìm thấy PDF: {source}")

    reader = PdfReader(str(source))
    if reader.is_encrypted:
        raise SystemExit("PDF đang được mã hóa; hãy dùng bản không khóa.")

    pages = len(reader.pages)
    print(f"PDF nguồn: {source}")
    print(f"Số trang: {pages}")

    if pages != EXPECTED_PAGES:
        raise SystemExit(f"Sai số trang: cần {EXPECTED_PAGES}, nhận {pages}.")

    if source != TARGET.resolve():
        print(f"Sao chép -> {TARGET}")
        shutil.copy2(source, TARGET)

    size_mb = TARGET.stat().st_size / (1024 * 1024)
    print(f"OK: {TARGET.name} - {size_mb:.2f} MB - {pages} trang")

    if not args.push:
        print("\nChưa push GitHub. Chạy lại với --push khi muốn xuất bản.")
        return

    print("\nĐang commit + push GitHub...")
    run("git", "add", TARGET.name)
    staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT)
    if staged.returncode == 0:
        print("PDF trên GitHub đã đúng phiên bản này; không có thay đổi.")
        return

    run("git", "commit", "-m", "Add Atlas Vietnam 1996 PDF - 172 pages")
    run("git", "pull", "--rebase", "origin", "main")
    run("git", "push", "origin", "HEAD:main")
    print("Hoàn tất. GitHub Pages sẽ tự deploy Flipbook.")


if __name__ == "__main__":
    main()
