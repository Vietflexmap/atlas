# Atlas Việt Nam 1996 — HTML5 Flipbook

Trình đọc Atlas dạng **quyển sách số** chạy thuần HTML/CSS/JavaScript, tối ưu cho desktop, tablet và điện thoại, xuất bản trực tiếp bằng GitHub Pages.

> **Nguồn hiển thị trên sản phẩm: Vietflexmap số hóa.**

## Trải nghiệm đọc

- 172 trang Atlas theo cấu trúc ảnh của viewer gốc.
- Hiệu ứng lật trang HTML5 bằng [StPageFlip](https://github.com/Nodlik/StPageFlip).
- Book-first UI: trang sách luôn là trung tâm, giao diện điều khiển tối giản.
- Responsive theo desktop, tablet, điện thoại dọc và điện thoại ngang.
- Drawer thumbnail 172 trang không làm co vùng sách.
- Thanh tiến độ 1–172 để kéo nhanh đến vị trí mong muốn.
- Trang đầu/cuối, trước/sau, nhập trực tiếp số trang và vùng bấm mép sách.
- Fullscreen, zoom và Focus Mode để đọc không bị phân tán.
- Ghi nhớ trang đọc gần nhất bằng `localStorage`.
- URL `#page=...` để chia sẻ đúng một trang Atlas.
- Phím tắt desktop và hỗ trợ thao tác cảm ứng.
- Fallback đọc đơn trang nếu thư viện Flipbook CDN không tải được.
- Hai chế độ nguồn: ảnh trực tuyến và ảnh lưu local trong repository.
- Tự chuyển về nguồn trực tuyến nếu yêu cầu `?source=local` nhưng chưa có ảnh local.
- Hỗ trợ `prefers-reduced-motion` và trạng thái focus/ARIA cơ bản.
- GitHub Actions tự deploy khi cập nhật nhánh `main`.

## Chạy ngay

Không cần build:

```bash
python -m http.server 8000
```

Mở `http://localhost:8000`.

> Không nên mở `index.html` bằng `file://` khi kiểm thử; hãy dùng HTTP server cục bộ.

## Nguồn ảnh

Website hiện dựng URL ảnh theo quy tắc:

```text
https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile/1.jpg
...
https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile/172.jpg
```

Cấu hình nằm ở đầu `app.js`:

```js
const TOTAL_PAGES = 172;
const REMOTE_BASE = 'https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile';
```

Dòng credit giao diện được đặt thống nhất là:

```text
Nguồn: Vietflexmap số hóa
```

## Lưu toàn bộ ảnh vào repository

Cài `requests`:

```bash
pip install requests
```

Tải 172 trang:

```bash
python scripts/download_pages.py
```

Script tạo:

```text
pages/
├── 1.jpg
├── 2.jpg
├── ...
├── 172.jpg
└── manifest.json
```

Sau khi commit thư mục `pages/`, mở website với:

```text
?source=local
```

Ví dụ:

```text
https://vietflexmap.github.io/atlas/?source=local#page=50
```

## GitHub Pages

Workflow `.github/workflows/pages.yml` đã có sẵn. Website được triển khai tại:

```text
https://vietflexmap.github.io/atlas/
```

Nếu Pages chưa được kích hoạt, vào **Settings → Pages → Build and deployment → Source → GitHub Actions**.

## Cấu trúc

```text
atlas/
├── index.html
├── style.css
├── app.js
├── .nojekyll
├── .github/
│   └── workflows/
│       └── pages.yml
├── scripts/
│   └── download_pages.py
└── pages/                 # tạo khi chạy downloader
```

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

## Ghi chú dữ liệu

Website là trình đọc và giao diện số hóa/hiển thị lại dữ liệu ảnh Atlas. Quyền đối với nội dung Atlas và ảnh nguồn thuộc về chủ sở hữu/đơn vị phát hành tương ứng; khi triển khai công khai hoặc sao lưu lâu dài cần bảo đảm quyền sử dụng phù hợp.
