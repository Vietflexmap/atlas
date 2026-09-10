# Atlas Việt Nam 1996 — HTML5 Flipbook

Trình đọc Atlas dạng sách lật chạy thuần HTML/CSS/JavaScript và có thể xuất bản trực tiếp bằng GitHub Pages.

## Tính năng

- 172 trang Atlas, nguồn ảnh theo viewer công khai tại `bandovn.vn/onlinescan/atlasvietnam/`.
- Hiệu ứng lật trang HTML5 bằng [StPageFlip](https://github.com/Nodlik/StPageFlip).
- Responsive desktop/mobile, tự chuyển portrait/landscape.
- Thumbnail 172 trang, nhảy tới trang bất kỳ.
- Trang đầu/cuối, trước/sau, phím ← →, Home/End, Space.
- Fullscreen và zoom 60–180%.
- URL nhớ trang hiện tại qua `#page=...` để chia sẻ thẳng một trang.
- Fallback đọc ảnh đơn trang nếu thư viện Flipbook CDN không tải được.
- Hai chế độ dữ liệu: ảnh nguồn trực tiếp và ảnh lưu local trong repository.
- GitHub Actions tự deploy mỗi khi cập nhật nhánh `main`.

## Chạy ngay

Không cần build:

```bash
python -m http.server 8000
```

Mở `http://localhost:8000`.

> Không nên mở `index.html` bằng `file://` khi kiểm thử; hãy dùng một HTTP server cục bộ.

## Nguồn ảnh

Mặc định website dựng URL theo quy tắc:

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

## Bật GitHub Pages lần đầu

Workflow `.github/workflows/pages.yml` đã có sẵn. Chỉ cần cấu hình Pages một lần:

1. Vào **Settings → Pages** của repository.
2. Trong **Build and deployment → Source**, chọn **GitHub Actions**.
3. Mở tab **Actions** và chạy lại workflow **Deploy Atlas to GitHub Pages** nếu lần chạy đầu tiên xảy ra trước khi Pages được bật.

Sau đó mỗi lần push lên `main` website sẽ tự deploy.

Địa chỉ dự kiến:

```text
https://vietflexmap.github.io/atlas/
```

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
| `+` / `-` | Zoom |
| `0` | Zoom 100% |

## Ghi chú dữ liệu

Website hiện chỉ là trình đọc/hiển thị lại dữ liệu ảnh. Quyền đối với nội dung Atlas và ảnh nguồn thuộc về chủ sở hữu/đơn vị phát hành tương ứng; khi triển khai công khai hoặc sao lưu lâu dài cần bảo đảm quyền sử dụng phù hợp.
