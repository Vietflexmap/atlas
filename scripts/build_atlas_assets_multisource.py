#!/usr/bin/env python3
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

TOTAL = 172
HOSTPATH = "www.bandovn.vn/onlinescan/atlasvietnam/files/mobile/{page}.jpg"
ORIGIN = "https://" + HOSTPATH
VIEWER = "https://www.bandovn.vn/onlinescan/atlasvietnam/"
ROOT = Path(__file__).resolve().parents[1]
PAGES = ROOT / "pages"
PDF = ROOT / "Atlas_Vietnam_1996.pdf"
MANIFEST = PAGES / "manifest.json"
MIN_BYTES = 8000
MAX_PDF = 92 * 1024 * 1024
TIMEOUT = 30
WORKERS = 8

# Each template receives a page number. We probe page 1 and use the first
# candidate that returns a real image. These are ordinary image-cache CDNs;
# they are used only during digitization. The final site reads local files.
def candidates(page: int) -> list[tuple[str, str]]:
    hostpath = HOSTPATH.format(page=page)
    https_origin = "https://" + hostpath
    http_origin = "http://" + hostpath
    return [
        ("wsrv-hostpath", f"https://wsrv.nl/?url={quote(hostpath, safe='/')}&output=jpg&q=100"),
        ("wsrv-http", f"https://wsrv.nl/?url={quote(http_origin, safe='')}&output=jpg&q=100"),
        ("weserv-hostpath", f"https://images.weserv.nl/?url={quote(hostpath, safe='/')}&output=jpg&q=100"),
        ("weserv-https", f"https://images.weserv.nl/?url={quote(https_origin, safe='')}&output=jpg&q=100"),
        ("wordpress-i0", f"https://i0.wp.com/{hostpath}?ssl=1"),
        ("wordpress-i1", f"https://i1.wp.com/{hostpath}?ssl=1"),
        ("wordpress-i2", f"https://i2.wp.com/{hostpath}?ssl=1"),
        ("google-gadgets", "https://images1-focus-opensocial.googleusercontent.com/gadgets/proxy?" +
            f"url={quote(https_origin, safe='')}&container=focus&refresh=2592000"),
    ]


def validate(data: bytes, page: int) -> tuple[int, int]:
    if len(data) < MIN_BYTES:
        raise ValueError(f"page {page}: only {len(data)} bytes")
    with Image.open(io.BytesIO(data)) as im:
        width, height = im.size
        im.verify()
    if width < 300 or height < 300:
        raise ValueError(f"page {page}: suspicious {width}x{height}")
    return width, height


def request_image(url: str, page: int, attempts: int = 2) -> tuple[bytes, int, int]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Vietflexmap Atlas Digitizer/1.0)",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    last = None
    for attempt in range(attempts):
        try:
            r = requests.get(url, headers=headers, timeout=TIMEOUT, allow_redirects=True)
            r.raise_for_status()
            w, h = validate(r.content, page)
            return r.content, w, h
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(str(last))


def pick_route() -> tuple[str, int]:
    print("Probing CDN routes for Atlas page 1...", flush=True)
    for index, (name, url) in enumerate(candidates(1)):
        try:
            data, w, h = request_image(url, 1, attempts=1)
            print(f"ROUTE OK: {name} -> {w}x{h}, {len(data)//1024} KiB", flush=True)
            PAGES.mkdir(parents=True, exist_ok=True)
            save_jpeg(data, PAGES / "1.jpg")
            return name, index
        except Exception as exc:  # noqa: BLE001
            print(f"route failed [{name}]: {exc}", flush=True)
    raise RuntimeError("No CDN route could retrieve Atlas page 1")


def save_jpeg(data: bytes, path: Path) -> tuple[int, int, int]:
    with Image.open(io.BytesIO(data)) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        buffer = io.BytesIO()
        im.save(buffer, "JPEG", quality=96, subsampling=0, optimize=True)
    out = buffer.getvalue()
    path.write_bytes(out)
    return w, h, len(out)


def download_one(page: int, route_index: int, route_name: str) -> dict:
    target = PAGES / f"{page}.jpg"
    if target.exists() and target.stat().st_size >= MIN_BYTES:
        try:
            data = target.read_bytes()
            w, h = validate(data, page)
            return {
                "page": page, "file": target.name, "status": "cached",
                "bytes": len(data), "width": w, "height": h,
                "sha256": hashlib.sha256(data).hexdigest(),
                "origin": ORIGIN.format(page=page), "retrievalRoute": route_name,
            }
        except Exception:
            target.unlink(missing_ok=True)

    url = candidates(page)[route_index][1]
    last = None
    for attempt in range(3):
        try:
            data, _, _ = request_image(url, page, attempts=1)
            w, h, size = save_jpeg(data, target)
            return {
                "page": page, "file": target.name, "status": "downloaded",
                "bytes": size, "width": w, "height": h,
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                "origin": ORIGIN.format(page=page), "retrievalRoute": route_name,
            }
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 * (attempt + 1))
    return {"page": page, "file": target.name, "status": "failed", "error": str(last)}


def download_all(route_name: str, route_index: int) -> list[dict]:
    PAGES.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = {pool.submit(download_one, p, route_index, route_name): p for p in range(1, TOTAL + 1)}
        for n, fut in enumerate(concurrent.futures.as_completed(futs), 1):
            item = fut.result()
            results.append(item)
            print(f"[{n:03d}/{TOTAL}] {'OK' if item['status'] != 'failed' else 'ERR'} page {item['page']:03d} {item.get('bytes',0)}", flush=True)
    results.sort(key=lambda x: x["page"])
    failed = [x for x in results if x["status"] == "failed"]
    if failed:
        raise RuntimeError("Failed pages: " + "; ".join(f"{x['page']}={x.get('error','')}" for x in failed))
    return results


def make_pdf(files: list[Path], output: Path) -> None:
    with output.open("wb") as fh:
        fh.write(img2pdf.convert([str(x) for x in files]))


def build_pdf() -> None:
    files = [PAGES / f"{p}.jpg" for p in range(1, TOTAL + 1)]
    missing = [x for x in files if not x.exists()]
    if missing:
        raise RuntimeError(f"Missing {len(missing)} local pages")
    tmp = PDF.with_suffix(".tmp.pdf")
    make_pdf(files, tmp)
    if tmp.stat().st_size <= MAX_PDF:
        tmp.replace(PDF)
        return
    tmp.unlink(missing_ok=True)

    with tempfile.TemporaryDirectory(prefix="atlas-pdf-") as td:
        base = Path(td)
        for q, maxside in [(88,2600),(82,2300),(76,2100),(70,1900),(64,1700)]:
            d = base / f"q{q}"
            d.mkdir()
            smaller = []
            for p, src in enumerate(files, 1):
                dst = d / f"{p}.jpg"
                with Image.open(src) as im:
                    im = im.convert("RGB")
                    w, h = im.size
                    scale = min(1, maxside / max(w,h))
                    if scale < 1:
                        im = im.resize((round(w*scale), round(h*scale)), Image.Resampling.LANCZOS)
                    im.save(dst, "JPEG", quality=q, optimize=True)
                smaller.append(dst)
            make_pdf(smaller, tmp)
            print(f"PDF q{q}: {tmp.stat().st_size/1024/1024:.1f} MB", flush=True)
            if tmp.stat().st_size <= MAX_PDF:
                tmp.replace(PDF)
                return
            tmp.unlink(missing_ok=True)
            shutil.rmtree(d, ignore_errors=True)
    raise RuntimeError("PDF remains above GitHub normal-file size limit")


def main() -> None:
    route_name, route_index = pick_route()
    results = download_all(route_name, route_index)
    MANIFEST.write_text(json.dumps({
        "title": "Atlas Việt Nam 1996",
        "credit": "Nguồn: Vietflexmap số hóa",
        "sourceViewer": VIEWER,
        "totalPages": TOTAL,
        "retrievalRoute": route_name,
        "generatedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pages": results,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    build_pdf()
    print(f"SUCCESS: 172/172, PDF={PDF.stat().st_size/1024/1024:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
