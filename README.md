# Atlas Việt Nam 1996 — HTML5 Flipbook

Trình đọc **Atlas Việt Nam 1996** dạng quyển sách số, tối ưu cho desktop, tablet và điện thoại, triển khai bằng GitHub Pages.

> **Nguồn hiển thị trên sản phẩm: Vietflexmap số hóa.**

## Kiến trúc production

Website được thiết kế để **đọc ảnh local trong repository**, không phụ thuộc máy chủ nguồn khi người dùng mở sách:

```text
bandovn.vn (chỉ dùng lúc số hóa)
        │
        ▼
Chrome same-origin trên máy số hóa
        │
        ├── pages/1.jpg ... pages/172.jpg
        ├── pages/manifest.json
        └── Atlas_Vietnam_1996.pdf
                    │
                    ▼
             Vietflexmap/atlas
                    │
          HTML5 Flipbook + PDF
```

Viewer gốc công bố chuỗi **172 ảnh**. Ấn phẩm vật lý thường được mô tả là **163 trang/lá**, nên số ảnh viewer có thể bao gồm bìa và các trang phụ của bản scan.

## Trải nghiệm đọc

- Flipbook 172 ảnh bằng **StPageFlip**.
- Desktop: trải nghiệm sách mở; mobile/tablet tự chuyển portrait/landscape phù hợp.
- Book-first UI, nền đọc trung tính và hiệu ứng bóng/gáy sách.
- Drawer thumbnail 172 trang.
- Thanh tiến độ 1–172, nhập số trang, nút trước/sau và vùng bấm mép sách.
- Fullscreen, zoom, Focus Mode.
- Ghi nhớ trang gần nhất bằng `localStorage`.
- URL `#page=...` để chia sẻ đúng trang.
- Phím tắt desktop và thao tác cảm ứng.
- Fallback đọc đơn trang nếu thư viện Flipbook gặp lỗi.
- `no-referrer` cho ảnh nguồn dự phòng nhằm giảm lỗi hotlink theo Referer.
- Nút tải PDF chỉ xuất hiện khi `Atlas_Vietnam_1996.pdf` thực sự tồn tại.
- GitHub Actions tự deploy website khi `main` thay đổi.

## Số hóa hoàn chỉnh trên Windows — 1 click

Máy chủ `bandovn.vn` hiện không phản hồi từ GitHub-hosted runners ở Mỹ và các CDN/proxy thử nghiệm cũng không lấy được ảnh. Vì vậy công cụ production dùng **Chrome trên máy Windows có thể mở viewer nguồn**, sau đó lấy ảnh bằng `fetch()` từ chính phiên same-origin của Chrome.

### Cách chạy

Clone repository:

```bash
git clone https://github.com/Vietflexmap/atlas.git
cd atlas
```

Sau đó double-click:

```text
BUILD_ATLAS_WINDOWS.bat
```

Công cụ tự động:

1. Cài/kiểm tra `selenium`, `pillow`, `img2pdf`, `requests`.
2. Mở Chrome vào viewer gốc.
3. Lấy lần lượt `1.jpg → 172.jpg` từ cùng origin/session Chrome.
4. Kiểm tra định dạng và kích thước từng ảnh.
5. Ghi `pages/manifest.json` kèm SHA-256.
6. Tạo `Atlas_Vietnam_1996.pdf`.
7. Nếu PDF vượt giới hạn file thông thường của GitHub, tự tối ưu chất lượng cao.
8. `git add`, commit, pull --rebase và push lên `main`.
9. GitHub Pages tự deploy lại.

**Không đóng cửa sổ Chrome tự động** trong lúc công cụ đang lấy 172 trang.

## Kết quả sau số hóa

```text
atlas/
├── Atlas_Vietnam_1996.pdf
├── pages/
│   ├── 1.jpg
│   ├── 2.jpg
│   ├── ...
│   ├── 172.jpg
│   └── manifest.json
├── index.html
├── style.css
├── app.js
├── BUILD_ATLAS_WINDOWS.bat
├── scripts/
│   ├── build_atlas_windows.py
│   ├── build_atlas_assets.py
│   └── download_pages.py
└── .github/workflows/pages.yml
```

Sau khi assets được push, website mặc định sử dụng `?source=local`. Có thể ép chế độ đối chiếu nguồn bằng:

```text
?source=remote
```

## Website

```text
https://vietflexmap.github.io/atlas/
```

Workflow deploy nằm tại `.github/workflows/pages.yml`.

## Chạy local để kiểm thử giao diện

```bash
python -m http.server 8000
```

Mở:

```text
http://localhost:8000/
```

Không nên mở `index.html` trực tiếp bằng `file://`.

## Phím tắt

| Phím | Chức năng |
|---|---|
| `←` / `PageUp` | Trang trước |
| `→` / `PageDown` / `Space` | Trang sau |
| `Home` | Trang 1 |
| `End` | Trang 172 |
| `F` | Fullscreen |
| `M` | Focus Mode |
| `Esc` | Đóng drawer / thoát Focus Mode |
| `+` / `-` | Zoom |
| `0` | Zoom 100% |

## Nguồn và quyền sử dụng

Nguồn scan trực tuyến được dùng làm đầu vào số hóa từ viewer công khai tại `bandovn.vn/onlinescan/atlasvietnam/`. Dòng nhận diện trên giao diện là **“Nguồn: Vietflexmap số hóa”**. Quyền đối với nội dung Atlas/ấn phẩm gốc vẫn thuộc chủ sở hữu và đơn vị phát hành tương ứng; việc công bố, sao lưu và phân phối cần bảo đảm quyền sử dụng phù hợp.
