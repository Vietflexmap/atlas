#!/usr/bin/env python3
"""Windows/browser-assisted digitizer for Atlas Việt Nam 1996.

Use this when bandovn.vn is reachable in the user's Chrome but inaccessible from
cloud runners or direct Python requests. Selenium opens the original viewer and
fetches every page image from *inside the same-origin browser session*, then
writes local pages/1.jpg ... pages/172.jpg and Atlas_Vietnam_1996.pdf.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import shutil
import tempfile
import time
from pathlib import Path

import img2pdf
from PIL import Image, ImageOps
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.support.ui import WebDriverWait

TOTAL = 172
VIEWER = "https://www.bandovn.vn/onlinescan/atlasvietnam/"
PAGE_PATH = "/onlinescan/atlasvietnam/files/mobile/{page}.jpg"
ROOT = Path(__file__).resolve().parents[1]
PAGES = ROOT / "pages"
MANIFEST = PAGES / "manifest.json"
PDF = ROOT / "Atlas_Vietnam_1996.pdf"
MAX_PDF = 92 * 1024 * 1024
MIN_BYTES = 5000

FETCH_SCRIPT = r"""
const path = arguments[0];
const done = arguments[arguments.length - 1];
fetch(path, {
  method: 'GET',
  credentials: 'include',
  cache: 'force-cache',
  referrer: location.href
})
.then(async response => {
  if (!response.ok) {
    done({ok:false, status:response.status, error:'HTTP ' + response.status});
    return;
  }
  const blob = await response.blob();
  const reader = new FileReader();
  reader.onloadend = () => done({
    ok:true,
    status:response.status,
    type:blob.type,
    data:reader.result
  });
  reader.onerror = () => done({ok:false, status:0, error:'FileReader error'});
  reader.readAsDataURL(blob);
})
.catch(error => done({ok:false, status:0, error:String(error)}));
"""


def validate(data: bytes, page: int) -> tuple[int, int, str]:
    if len(data) < MIN_BYTES:
        raise RuntimeError(f"Trang {page}: file quá nhỏ ({len(data)} bytes)")
    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            fmt = image.format or "UNKNOWN"
            image.verify()
    except Exception as exc:
        raise RuntimeError(f"Trang {page}: dữ liệu không phải ảnh hợp lệ: {exc}") from exc
    if width < 300 or height < 300:
        raise RuntimeError(f"Trang {page}: kích thước bất thường {width}x{height}")
    return width, height, fmt


def make_driver() -> webdriver.Chrome:
    options = webdriver.ChromeOptions()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    try:
        driver = webdriver.Chrome(options=options)
    except WebDriverException as exc:
        raise RuntimeError(
            "Không mở được Google Chrome. Hãy cài/cập nhật Chrome rồi chạy lại. "
            f"Chi tiết: {exc}"
        ) from exc

    driver.set_script_timeout(75)
    driver.set_page_load_timeout(75)
    return driver


def open_viewer(driver: webdriver.Chrome) -> None:
    print(f"Mở viewer: {VIEWER}", flush=True)
    driver.get(VIEWER)
    WebDriverWait(driver, 40).until(
        lambda d: d.execute_script("return document.readyState") in ("interactive", "complete")
    )
    time.sleep(2)
    current = driver.current_url
    if "bandovn.vn" not in current:
        raise RuntimeError(f"Chrome không ở đúng bandovn.vn. URL hiện tại: {current}")
    print("Viewer đã mở. Bắt đầu lấy ảnh từ cùng phiên Chrome...", flush=True)


def fetch_page(driver: webdriver.Chrome, page: int) -> bytes:
    path = PAGE_PATH.format(page=page)
    last_error = None
    for attempt in range(1, 4):
        try:
            result = driver.execute_async_script(FETCH_SCRIPT, path)
            if not isinstance(result, dict) or not result.get("ok"):
                raise RuntimeError((result or {}).get("error", "fetch() không trả dữ liệu"))
            data_url = result.get("data", "")
            if "," not in data_url:
                raise RuntimeError("Data URL không hợp lệ")
            raw = base64.b64decode(data_url.split(",", 1)[1])
            validate(raw, page)
            return raw
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            print(f"  Thử lại trang {page} ({attempt}/3): {exc}", flush=True)
            time.sleep(attempt * 1.25)
    raise RuntimeError(f"Trang {page} thất bại sau 3 lần: {last_error}")


def download_pages(driver: webdriver.Chrome) -> list[dict]:
    PAGES.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []

    for page in range(1, TOTAL + 1):
        target = PAGES / f"{page}.jpg"
        if target.exists() and target.stat().st_size >= MIN_BYTES:
            try:
                raw = target.read_bytes()
                width, height, fmt = validate(raw, page)
                records.append({
                    "page": page,
                    "file": target.name,
                    "bytes": len(raw),
                    "width": width,
                    "height": height,
                    "format": fmt,
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "status": "cached",
                })
                print(f"[{page:03d}/{TOTAL}] CACHED {len(raw)/1024:.0f} KiB", flush=True)
                continue
            except Exception:
                target.unlink(missing_ok=True)

        raw = fetch_page(driver, page)
        width, height, fmt = validate(raw, page)
        target.write_bytes(raw)
        records.append({
            "page": page,
            "file": target.name,
            "bytes": len(raw),
            "width": width,
            "height": height,
            "format": fmt,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "status": "downloaded-browser-same-origin",
        })
        print(
            f"[{page:03d}/{TOTAL}] OK {width}x{height} {len(raw)/1024:.0f} KiB",
            flush=True,
        )

    return records


def write_manifest(records: list[dict]) -> None:
    MANIFEST.write_text(
        json.dumps({
            "title": "Atlas Việt Nam 1996",
            "credit": "Nguồn: Vietflexmap số hóa",
            "sourceViewer": VIEWER,
            "retrievalMode": "Chrome same-origin Selenium",
            "totalPages": TOTAL,
            "generatedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "pages": records,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def page_files() -> list[Path]:
    files = [PAGES / f"{page}.jpg" for page in range(1, TOTAL + 1)]
    missing = [path for path in files if not path.exists()]
    if missing:
        raise RuntimeError(f"Thiếu {len(missing)} trang sau khi tải")
    return files


def make_pdf(files: list[Path], output: Path) -> None:
    with output.open("wb") as stream:
        stream.write(img2pdf.convert([str(path) for path in files]))


def build_pdf() -> None:
    files = page_files()
    temp_pdf = PDF.with_suffix(".tmp.pdf")
    make_pdf(files, temp_pdf)
    size = temp_pdf.stat().st_size
    print(f"PDF ảnh gốc: {size/1024/1024:.1f} MB", flush=True)

    if size <= MAX_PDF:
        temp_pdf.replace(PDF)
        return

    temp_pdf.unlink(missing_ok=True)
    print("PDF vượt giới hạn file GitHub; đang tối ưu nhưng vẫn giữ chất lượng cao...", flush=True)

    with tempfile.TemporaryDirectory(prefix="atlas-pdf-") as temp:
        root = Path(temp)
        for quality, max_side in [(90, 3000), (86, 2700), (82, 2400), (78, 2200), (74, 2000), (70, 1800)]:
            work = root / f"q{quality}_{max_side}"
            work.mkdir()
            optimized: list[Path] = []
            for index, source in enumerate(files, start=1):
                destination = work / f"{index}.jpg"
                with Image.open(source) as image:
                    image = ImageOps.exif_transpose(image).convert("RGB")
                    width, height = image.size
                    factor = min(1.0, max_side / max(width, height))
                    if factor < 1.0:
                        image = image.resize(
                            (max(1, round(width * factor)), max(1, round(height * factor))),
                            Image.Resampling.LANCZOS,
                        )
                    image.save(destination, "JPEG", quality=quality, optimize=True)
                optimized.append(destination)

            make_pdf(optimized, temp_pdf)
            size = temp_pdf.stat().st_size
            print(f"  q={quality}, max={max_side}: {size/1024/1024:.1f} MB", flush=True)
            if size <= MAX_PDF:
                temp_pdf.replace(PDF)
                return
            temp_pdf.unlink(missing_ok=True)
            shutil.rmtree(work, ignore_errors=True)

    raise RuntimeError("Không thể tối ưu PDF xuống dưới giới hạn file thông thường của GitHub")


def main() -> None:
    driver = make_driver()
    try:
        open_viewer(driver)
        # Kiểm tra trang 1 ngay; nếu lỗi thì dừng sớm với thông báo rõ.
        test = fetch_page(driver, 1)
        width, height, _ = validate(test, 1)
        print(f"Kiểm tra trang 1 thành công: {width}x{height}", flush=True)
        (PAGES).mkdir(parents=True, exist_ok=True)
        (PAGES / "1.jpg").write_bytes(test)
        records = download_pages(driver)
    finally:
        try:
            driver.quit()
        except Exception:
            pass

    if len(records) != TOTAL:
        raise RuntimeError(f"Chỉ lấy được {len(records)}/{TOTAL} trang")
    write_manifest(records)
    build_pdf()
    print("=" * 68, flush=True)
    print("HOÀN TẤT: 172/172 TRANG", flush=True)
    print(f"PDF: {PDF}", flush=True)
    print("Nguồn: Vietflexmap số hóa", flush=True)
    print("=" * 68, flush=True)


if __name__ == "__main__":
    main()
