(() => {
  'use strict';

  const TOTAL_PAGES = 172;
  const REMOTE_BASE = 'https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile';
  const params = new URLSearchParams(location.search);
  const SOURCE_MODE = params.get('source') === 'local' ? 'local' : 'remote';

  const el = {
    readerLayout: document.querySelector('.reader-layout'),
    stage: document.getElementById('readerStage'),
    sidebar: document.getElementById('sidebar'),
    thumbGrid: document.getElementById('thumbGrid'),
    loading: document.getElementById('loadingState'),
    bookWrap: document.getElementById('bookWrap'),
    book: document.getElementById('book'),
    fallback: document.getElementById('fallbackReader'),
    fallbackImage: document.getElementById('fallbackImage'),
    pageInput: document.getElementById('pageInput'),
    pageTotal: document.getElementById('pageTotal'),
    toggleThumbs: document.getElementById('toggleThumbsBtn'),
    fullscreen: document.getElementById('fullscreenBtn'),
    first: document.getElementById('firstBtn'),
    prev: document.getElementById('prevBtn'),
    next: document.getElementById('nextBtn'),
    last: document.getElementById('lastBtn'),
    zoomIn: document.getElementById('zoomInBtn'),
    zoomOut: document.getElementById('zoomOutBtn'),
    resetZoom: document.getElementById('resetZoomBtn'),
    zoomLabel: document.getElementById('zoomLabel')
  };

  let pageFlip = null;
  let currentPage = 1;
  let zoom = 1;
  let fallbackMode = false;

  const pageUrl = (page) => SOURCE_MODE === 'local'
    ? `pages/${page}.jpg`
    : `${REMOTE_BASE}/${page}.jpg`;

  const pageUrls = Array.from({ length: TOTAL_PAGES }, (_, i) => pageUrl(i + 1));

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function buildThumbnails() {
    const frag = document.createDocumentFragment();

    for (let i = 1; i <= TOTAL_PAGES; i++) {
      const button = document.createElement('button');
      button.className = 'thumb';
      button.type = 'button';
      button.dataset.page = String(i);
      button.title = `Mở trang ${i}`;

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = `Trang ${i}`;
      img.src = pageUrl(i);

      // Khi dùng ?source=local nhưng file chưa tải, thumbnail tự quay về nguồn gốc.
      if (SOURCE_MODE === 'local') {
        img.addEventListener('error', () => {
          if (img.dataset.fallback !== '1') {
            img.dataset.fallback = '1';
            img.src = `${REMOTE_BASE}/${i}.jpg`;
          }
        }, { once: true });
      }

      const badge = document.createElement('span');
      badge.textContent = String(i);

      button.append(img, badge);
      button.addEventListener('click', () => goToPage(i));
      frag.appendChild(button);
    }

    el.thumbGrid.appendChild(frag);
  }

  function setActiveThumbnail(page) {
    document.querySelectorAll('.thumb.active').forEach(node => node.classList.remove('active'));
    const target = el.thumbGrid.querySelector(`[data-page="${page}"]`);
    if (!target) return;
    target.classList.add('active');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function updatePageUI(page) {
    currentPage = clamp(Number(page) || 1, 1, TOTAL_PAGES);
    el.pageInput.value = String(currentPage);
    setActiveThumbnail(currentPage);
    history.replaceState(null, '', `#page=${currentPage}`);
  }

  function initialPageFromHash() {
    const match = location.hash.match(/page=(\d+)/i);
    return match ? clamp(Number(match[1]), 1, TOTAL_PAGES) : 1;
  }

  function showError(message) {
    el.loading.hidden = false;
    el.loading.querySelector('.spinner')?.remove();
    const strong = el.loading.querySelector('strong');
    const span = el.loading.querySelector('span');
    if (strong) strong.textContent = 'Không tải được Flipbook';
    if (span) span.textContent = message;
  }

  function startFallback() {
    fallbackMode = true;
    el.bookWrap.hidden = true;
    el.loading.hidden = true;
    el.fallback.hidden = false;
    renderFallback(currentPage);
  }

  function renderFallback(page) {
    const target = clamp(page, 1, TOTAL_PAGES);
    el.fallbackImage.src = pageUrl(target);
    el.fallbackImage.alt = `Atlas Việt Nam - trang ${target}`;
    updatePageUI(target);
  }

  function goToPage(page) {
    const target = clamp(Number(page) || 1, 1, TOTAL_PAGES);

    if (fallbackMode || !pageFlip) {
      renderFallback(target);
      return;
    }

    // StPageFlip dùng index bắt đầu từ 0.
    pageFlip.turnToPage(target - 1);
    updatePageUI(target);
  }

  function flipPrev() {
    if (fallbackMode || !pageFlip) return goToPage(currentPage - 1);
    pageFlip.flipPrev();
  }

  function flipNext() {
    if (fallbackMode || !pageFlip) return goToPage(currentPage + 1);
    pageFlip.flipNext();
  }

  function setZoom(next) {
    zoom = clamp(Math.round(next * 100) / 100, 0.6, 1.8);
    document.documentElement.style.setProperty('--book-scale', String(zoom));
    el.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen không khả dụng:', err);
    }
  }

  function bindControls() {
    el.prev.addEventListener('click', flipPrev);
    el.next.addEventListener('click', flipNext);
    el.first.addEventListener('click', () => goToPage(1));
    el.last.addEventListener('click', () => goToPage(TOTAL_PAGES));

    el.pageInput.addEventListener('change', () => goToPage(el.pageInput.value));
    el.pageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        goToPage(el.pageInput.value);
        el.pageInput.blur();
      }
    });

    el.toggleThumbs.addEventListener('click', () => {
      el.sidebar.classList.toggle('is-hidden');
      el.readerLayout.classList.toggle('sidebar-closed', el.sidebar.classList.contains('is-hidden'));
    });

    el.fullscreen.addEventListener('click', toggleFullscreen);
    el.zoomIn.addEventListener('click', () => setZoom(zoom + 0.1));
    el.zoomOut.addEventListener('click', () => setZoom(zoom - 0.1));
    el.resetZoom.addEventListener('click', () => setZoom(1));

    document.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;

      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        flipPrev();
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        flipNext();
      }
      if (event.key === 'Home') goToPage(1);
      if (event.key === 'End') goToPage(TOTAL_PAGES);
      if (event.key.toLowerCase() === 'f') toggleFullscreen();
      if (event.key === '+' || event.key === '=') setZoom(zoom + 0.1);
      if (event.key === '-') setZoom(zoom - 0.1);
      if (event.key === '0') setZoom(1);
    });

    el.stage.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });

    window.addEventListener('hashchange', () => {
      const page = initialPageFromHash();
      if (page !== currentPage) goToPage(page);
    });
  }

  function initFlipbook() {
    currentPage = initialPageFromHash();
    updatePageUI(currentPage);

    if (!window.St || typeof window.St.PageFlip !== 'function') {
      console.warn('StPageFlip CDN không khả dụng. Chuyển sang chế độ đọc đơn trang.');
      startFallback();
      return;
    }

    try {
      pageFlip = new window.St.PageFlip(el.book, {
        width: 1000,
        height: 707,
        size: 'stretch',
        minWidth: 280,
        maxWidth: 1100,
        minHeight: 198,
        maxHeight: 778,
        maxShadowOpacity: 0.45,
        showCover: true,
        mobileScrollSupport: false,
        usePortrait: true,
        autoSize: true,
        drawShadow: true,
        flippingTime: 700,
        clickEventForward: true,
        swipeDistance: 24,
        showPageCorners: true,
        disableFlipByClick: false
      });

      pageFlip.on('init', () => {
        el.loading.hidden = true;
        el.bookWrap.hidden = false;
        goToPage(currentPage);
      });

      pageFlip.on('flip', (event) => {
        updatePageUI(Number(event.data) + 1);
      });

      pageFlip.on('changeOrientation', () => {
        setTimeout(() => pageFlip.update(), 60);
      });

      pageFlip.loadFromImages(pageUrls);

      // Nếu thư viện khởi tạo nhưng ảnh bị chặn hoàn toàn, người dùng vẫn có thể
      // chuyển sang nguồn local bằng cách chạy scripts/download_pages.py và mở ?source=local.
      setTimeout(() => {
        if (!pageFlip) startFallback();
      }, 5000);
    } catch (err) {
      console.error(err);
      startFallback();
    }
  }

  el.fallbackImage.addEventListener('error', () => {
    if (SOURCE_MODE === 'local' && el.fallbackImage.dataset.fallback !== '1') {
      el.fallbackImage.dataset.fallback = '1';
      el.fallbackImage.src = `${REMOTE_BASE}/${currentPage}.jpg`;
      return;
    }
    showError('Ảnh nguồn không phản hồi. Hãy tải ảnh về thư mục pages/ bằng script kèm theo và mở trang với ?source=local.');
  });

  el.pageTotal.textContent = String(TOTAL_PAGES);
  buildThumbnails();
  bindControls();

  // Mobile mặc định giấu sidebar để ưu tiên diện tích bản đồ.
  if (matchMedia('(max-width: 900px)').matches) {
    el.sidebar.classList.add('is-hidden');
    el.readerLayout.classList.add('sidebar-closed');
  }

  initFlipbook();
})();
