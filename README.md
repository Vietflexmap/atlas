# Atlas Việt Nam 1996 — Flipbook HTML5 172 trang

Trình đọc **Atlas Việt Nam 1996** dạng quyển sách số, tối ưu cho desktop, tablet và điện thoại, triển khai trực tiếp bằng GitHub Pages.

> **Nguồn hiển thị trên sản phẩm: Vietflexmap số hóa.**

## Kiến trúc production mới

Bản production dùng **một PDF local 172 trang** làm nguồn duy nhất. Trình duyệt dùng PDF.js render trang theo nhu cầu, sau đó StPageFlip tạo hiệu ứng lật sách HTML5.

```text
Atlas_Vietnam_1996.pdf (172 trang)
              │
              ▼
           PDF.js
     render canvas theo nhu cầu
              │
      ┌───────┴────────┐
      ▼                ▼
 StPageFlip         Thumbnail
 HTML5 book         lazy render
      │
      ▼
Desktop / Tablet / Mobile
```

Không cần lưu 172 ảnh JPG riêng trong repository và không còn phụ thuộc hotlink từ máy chủ nguồn khi người dùng đọc sách.

## Trải nghiệm đọc

- **172 trang** đọc trực tiếp từ `Atlas_Vietnam_1996.pdf`.
- Hiệu ứng lật trang bằng **StPageFlip 2.0.7**.
- Render PDF bằng **PDF.js** với lazy rendering để giảm RAM và thời gian mở sách.
- Desktop hiển thị sách mở hai trang; màn hình hẹp tự chuyển trải nghiệm một trang.
- Trang bìa và trang cuối được xử lý như bìa cứng của Flipbook.
- Drawer thumbnail 172 trang, chỉ render thumbnail khi người dùng cuộn đến.
- Thanh tiến độ, nhập số trang, trang đầu/cuối, trước/sau.
- Vùng bấm mép trái/phải để lật nhanh.
- Fullscreen, zoom 65–180%, Focus Mode.
- Ghi nhớ trang đọc gần nhất bằng `localStorage`.
- Link trực tiếp dạng `#page=75`.
- Phím tắt desktop: mũi tên, PageUp/PageDown, Home/End, F, M, +, -, 0.
- Hỗ trợ `prefers-reduced-motion` và accessibility cơ bản.
- Fallback đọc một trang nếu thư viện StPageFlip không tải được.
- Dòng credit cố định: **Nguồn: Vietflexmap số hóa**.

## File bắt buộc

Đặt PDF tại thư mục gốc repository với tên chính xác:

```text
Atlas_Vietnam_1996.pdf
```

Cấu trúc production:

```text
atlas/
├── Atlas_Vietnam_1996.pdf
├── index.html
├── style.css
├── app.js
├── PUBLISH_PDF_WINDOWS.bat
├── scripts/
│   └── publish_local_pdf.py
└── .github/
    └── workflows/
        └── pages.yml
```

## Xuất bản PDF 172 trang trên Windows

Clone/pull repository:

```bash
git clone https://github.com/Vietflexmap/atlas.git
cd atlas
```

Cách nhanh nhất: **kéo file PDF 172 trang và thả trực tiếp lên**:

```text
PUBLISH_PDF_WINDOWS.bat
```

Tool sẽ:

1. Kiểm tra PDF bằng `pypdf`.
2. Bắt buộc đúng **172 trang**.
3. Đổi/copy thành `Atlas_Vietnam_1996.pdf`.
4. `git add` + commit + pull --rebase + push lên `main`.
5. GitHub Pages tự deploy lại Flipbook.

Có thể chạy bằng Python:

```bash
pip install pypdf
python scripts/publish_local_pdf.py "D:\\Atlas.pdf" --push
```

## Website

```text
https://vietflexmap.github.io/atlas/
```

## Chạy local

```bash
python -m http.server 8000
```

Mở:

```text
http://localhost:8000/
```

Không mở bằng `file://` vì PDF.js cần được phục vụ qua HTTP/HTTPS.

## Lưu ý hiệu năng

PDF 172 trang không được render toàn bộ ngay khi mở. Ứng dụng chỉ render trang hiện tại và một số trang lân cận; thumbnail cũng được render theo viewport của drawer. Cách này giúp Flipbook hoạt động ổn định hơn trên điện thoại và tablet có RAM thấp.

## Nguồn và quyền sử dụng

Dòng nhận diện trên sản phẩm là **“Nguồn: Vietflexmap số hóa”**. Quyền đối với nội dung Atlas/ấn phẩm gốc vẫn thuộc chủ sở hữu và đơn vị phát hành tương ứng; việc công bố, sao lưu và phân phối cần bảo đảm quyền sử dụng phù hợp.
