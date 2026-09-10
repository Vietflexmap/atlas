(() => {
  'use strict';

  const TOTAL_PAGES = 172;
  const REMOTE_BASE = 'https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile';
  const STORAGE_KEY = 'vietflexmap-atlas-last-page';
  const params = new URLSearchParams(location.search);
  const requestedMode = params.get('source') === 'local' ? 'local' : 'remote';

  const el = {
    app: document.getElementById('appShell'),
    readerLayout: document.getElementById('readerLayout'),
    stage: document.getElementById('readerStage'),
    sidebar: document.getElementById('sidebar'),
    scrim: document.getElementById('drawerScrim'),
    thumbGrid: document.getElementById('thumbGrid'),
    loading: document.getElementById('loadingState'),
    bookWrap: document.getElementById('bookWrap'),
    book: document.getElementById('book'),
    fallback: document.getElementById('fallbackReader'),
    fallbackImage: document.getElementById('fallbackImage'),
    pageInput: document.getElementById('pageInput'),
    pageTotal: document.getElementById('pageTotal'),
    pageRange: document.getElementById('pageRange'),
    progressPage: document.getElementById('progressPage'),
    progressTotal: document.getElementById('progressTotal'),
    toggleThumbs: document.getElementById('toggleThumbsBtn'),
    closeThumbs: document.getElementById('closeThumbsBtn'),
    fullscreen: document.getElementById('fullscreenBtn'),
    focus: document.getElementById('focusBtn'),
    first: document.getElementById('firstBtn'),
    prev: document.getElementById('prevBtn'),
    next: document.getElementById('nextBtn'),
    last: document.getElementById('lastBtn'),
    edgePrev: document.getElementById('edgePrev'),
    edgeNext: document.getElementById('edgeNext'),
    zoomIn: document.getElementById('zoomInBtn'),
    zoomOut: document.getElementById('zoomOutBtn'),
    resetZoom: document.getElementById('resetZoomBtn'),
    zoomLabel: document.getElementById('zoomLabel'),
    toast: document.getElementById('toast')
  };

  let effectiveMode = requestedMode;
  let pageFlip = null;
  let currentPage = 1;
  let zoom = 1;
  let fallbackMode = false;
  let drawerOpen = false;
  let toastTimer = 0;
  let resizeTimer = 0;
  let touchStartX = null;
  let touchStartY = null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const remoteUrl = (page) => `${REMOTE_BASE}/${page}.jpg`;
  const localUrl = (page) => `pages/${page}.jpg`;
  const pageUrl = (page) => effectiveMode === 'local' ? localUrl(page) : remoteUrl(page);
  const padPage = (page) => String(page).padStart(2, '0');

  function testImage(url, timeout = 3500) {
    return new Promise((resolve) => {
      const image = new Image();
      const timer = window.setTimeout(() => {
        image.onload = image.onerror = null;
        resolve(false);
      }, timeout);
      image.onload = () => { clearTimeout(timer); resolve(true); };
      image.onerror = () => { clearTimeout(timer); resolve(false); };
      image.src = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
    });
  }

  async function resolveSourceMode() {
    if (requestedMode !== 'local') return;
    const localReady = await testImage(localUrl(1), 2200);
    if (!localReady) {
      effectiveMode = 'remote';
      showToast('Chưa có ảnh local — đang dùng nguồn ảnh trực tuyến.');
    }
  }

  function showToast(message, duration = 2400) {
    if (!el.toast) return;
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.hidden = false;
    toastTimer = window.setTimeout(() => { el.toast.hidden = true; }, duration);
  }

  function buildThumbnails() {
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= TOTAL_PAGES; i++) {
      const button = document.createElement('button');
      button.className = 'thumb';
      button.type = 'button';
      button.dataset.page = String(i);
      button.title = `Mở trang ${i}`;
      button.setAttribute('role', 'listitem');
      button.setAttribute('aria-label', `Mở trang ${i}`);

      const img = document.createElement('img');
      img.loading = i <= 4 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.alt = `Ảnh thu nhỏ trang ${i}`;
      img.src = pageUrl(i);
      img.addEventListener('error', () => {
        if (effectiveMode === 'local' && img.dataset.remoteFallback !== '1') {
          img.dataset.remoteFallback = '1';
          img.src = remoteUrl(i);
        }
      }, { once: true });

      const badge = document.createElement('span');
      badge.textContent = String(i);
      button.append(img, badge);
      button.addEventListener('click', () => {
        goToPage(i);
        closeDrawer();
      });
      frag.appendChild(button);
    }
    el.thumbGrid.replaceChildren(frag);
  }

  function setActiveThumbnail(page) {
    const old = el.thumbGrid.querySelector('.thumb.active');
    if (old) old.classList.remove('active');
    const target = el.thumbGrid.querySelector(`[data-page="${page}"]`);
    if (!target) return;
    target.classList.add('active');
    if (drawerOpen) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function updateRangeFill(page) {
    const percent = TOTAL_PAGES <= 1 ? 0 : ((page - 1) / (TOTAL_PAGES - 1)) * 100;
    el.pageRange.style.background = `linear-gradient(90deg, var(--gold) 0%, var(--gold) ${percent}%, rgba(255,255,255,.12) ${percent}%, rgba(255,255,255,.12) 100%)`;
  }

  function updatePageUI(page, { persist = true } = {}) {
    currentPage = clamp(Number(page) || 1, 1, TOTAL_PAGES);
    el.pageInput.value = String(currentPage);
    el.pageRange.value = String(currentPage);
    el.progressPage.textContent = padPage(currentPage);
    updateRangeFill(currentPage);
    setActiveThumbnail(currentPage);

    const atFirst = currentPage <= 1;
    const atLast = currentPage >= TOTAL_PAGES;
    [el.first, el.prev, el.edgePrev].forEach(btn => { if (btn) btn.disabled = atFirst; });
    [el.last, el.next, el.edgeNext].forEach(btn => { if (btn) btn.disabled = atLast; });

    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, String(currentPage)); } catch (_) {}
    }

    const nextHash = `#page=${currentPage}`;
    if (location.hash !== nextHash) history.replaceState(null, '', nextHash);
    document.title = `Atlas Việt Nam 1996 — Trang ${currentPage} | Vietflexmap số hóa`;
  }

  function initialPage() {
    const hashMatch = location.hash.match(/page=(\d+)/i);
    if (hashMatch) return clamp(Number(hashMatch[1]), 1, TOTAL_PAGES);
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= 1 && saved <= TOTAL_PAGES) return saved;
    } catch (_) {}
    return 1;
  }

  function setLoadingError(title, message) {
    el.loading.hidden = false;
    el.loading.querySelector('.spinner')?.remove();
    const strong = el.loading.querySelector('strong');
    const span = el.loading.querySelector('span');
    if (strong) strong.textContent = title;
    if (span) span.textContent = message;
  }

  function startFallback(message) {
    fallbackMode = true;
    el.bookWrap.hidden = true;
    el.loading.hidden = true;
    el.fallback.hidden = false;
    renderFallback(currentPage);
    if (message) showToast(message, 3200);
  }

  function renderFallback(page) {
    const target = clamp(Number(page) || 1, 1, TOTAL_PAGES);
    el.fallbackImage.dataset.remoteFallback = '';
    el.fallbackImage.src = pageUrl(target);
    el.fallbackImage.alt = `Atlas Việt Nam — trang ${target}`;
    updatePageUI(target);
  }

  function goToPage(page) {
    const target = clamp(Number(page) || 1, 1, TOTAL_PAGES);
    if (fallbackMode || !pageFlip) {
      renderFallback(target);
      return;
    }
    pageFlip.turnToPage(target - 1);
    updatePageUI(target);
  }

  function flipPrev() {
    if (currentPage <= 1) return;
    if (fallbackMode || !pageFlip) return goToPage(currentPage - 1);
    pageFlip.flipPrev();
  }

  function flipNext() {
    if (currentPage >= TOTAL_PAGES) return;
    if (fallbackMode || !pageFlip) return goToPage(currentPage + 1);
    pageFlip.flipNext();
  }

  function setZoom(next) {
    zoom = clamp(Math.round(next * 100) / 100, 0.65, 1.8);
    document.documentElement.style.setProperty('--book-scale', String(zoom));
    el.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function openDrawer() {
    drawerOpen = true;
    el.sidebar.classList.add('is-open');
    el.sidebar.setAttribute('aria-hidden', 'false');
    el.toggleThumbs.setAttribute('aria-expanded', 'true');
    el.scrim.hidden = false;
    setActiveThumbnail(currentPage);
    setTimeout(() => el.closeThumbs.focus(), 120);
  }

  function closeDrawer({ restoreFocus = false } = {}) {
    if (!drawerOpen) return;
    drawerOpen = false;
    el.sidebar.classList.remove('is-open');
    el.sidebar.setAttribute('aria-hidden', 'true');
    el.toggleThumbs.setAttribute('aria-expanded', 'false');
    el.scrim.hidden = true;
    if (restoreFocus) el.toggleThumbs.focus();
  }

  function toggleDrawer() {
    drawerOpen ? closeDrawer({ restoreFocus: true }) : openDrawer();
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        showToast('Đã bật toàn màn hình');
      } else {
        await document.exitFullscreen();
      }
    } catch (_) {
      showToast('Thiết bị/trình duyệt này không hỗ trợ toàn màn hình.');
    }
  }

  function toggleFocus(force) {
    const next = typeof force === 'boolean' ? force : !el.app.classList.contains('focus-mode');
    el.app.classList.toggle('focus-mode', next);
    el.focus.setAttribute('aria-pressed', String(next));
    el.focus.title = next ? 'Thoát chế độ tập trung' : 'Chế độ tập trung';
    if (next) closeDrawer();
    window.setTimeout(() => {
      try { pageFlip?.update?.(); } catch (_) {}
    }, 240);
  }

  function bindControls() {
    el.prev.addEventListener('click', flipPrev);
    el.next.addEventListener('click', flipNext);
    el.edgePrev.addEventListener('click', flipPrev);
    el.edgeNext.addEventListener('click', flipNext);
    el.first.addEventListener('click', () => goToPage(1));
    el.last.addEventListener('click', () => goToPage(TOTAL_PAGES));

    el.pageInput.addEventListener('change', () => goToPage(el.pageInput.value));
    el.pageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        goToPage(el.pageInput.value);
        el.pageInput.blur();
      }
    });

    el.pageRange.addEventListener('input', () => {
      const preview = clamp(Number(el.pageRange.value), 1, TOTAL_PAGES);
      el.progressPage.textContent = padPage(preview);
      el.pageInput.value = String(preview);
      updateRangeFill(preview);
    });
    el.pageRange.addEventListener('change', () => goToPage(el.pageRange.value));

    el.toggleThumbs.addEventListener('click', toggleDrawer);
    el.closeThumbs.addEventListener('click', () => closeDrawer({ restoreFocus: true }));
    el.scrim.addEventListener('click', () => closeDrawer({ restoreFocus: true }));
    el.fullscreen.addEventListener('click', toggleFullscreen);
    el.focus.addEventListener('click', () => toggleFocus());
    el.zoomIn.addEventListener('click', () => setZoom(zoom + 0.1));
    el.zoomOut.addEventListener('click', () => setZoom(zoom - 0.1));
    el.resetZoom.addEventListener('click', () => setZoom(1));

    document.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') {
        if (drawerOpen) return closeDrawer({ restoreFocus: true });
        if (el.app.classList.contains('focus-mode')) return toggleFocus(false);
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault(); flipPrev();
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault(); flipNext();
      }
      if (event.key === 'Home') goToPage(1);
      if (event.key === 'End') goToPage(TOTAL_PAGES);
      if (event.key.toLowerCase() === 'f') toggleFullscreen();
      if (event.key.toLowerCase() === 'm') toggleFocus();
      if (event.key === '+' || event.key === '=') setZoom(zoom + 0.1);
      if (event.key === '-') setZoom(zoom - 0.1);
      if (event.key === '0') setZoom(1);
    });

    el.stage.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });

    el.stage.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    }, { passive: true });

    el.stage.addEventListener('touchend', (event) => {
      if (!fallbackMode || touchStartX == null || touchStartY == null || !event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      touchStartX = touchStartY = null;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      dx < 0 ? flipNext() : flipPrev();
    }, { passive: true });

    window.addEventListener('hashchange', () => {
      const match = location.hash.match(/page=(\d+)/i);
      if (!match) return;
      const page = clamp(Number(match[1]), 1, TOTAL_PAGES);
      if (page !== currentPage) goToPage(page);
    });

    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (matchMedia('(max-width: 560px)').matches && drawerOpen) closeDrawer();
        try { pageFlip?.update?.(); } catch (_) {}
      }, 180);
    }, { passive: true });

    document.addEventListener('fullscreenchange', () => {
      el.fullscreen.textContent = document.fullscreenElement ? '×' : '⛶';
      el.fullscreen.setAttribute('aria-label', document.fullscreenElement ? 'Thoát toàn màn hình' : 'Toàn màn hình');
    });
  }

  function initFlipbook() {
    currentPage = initialPage();
    updatePageUI(currentPage, { persist: false });

    if (!window.St || typeof window.St.PageFlip !== 'function') {
      startFallback('Đang dùng chế độ đọc tương thích vì thư viện lật trang chưa tải được.');
      return;
    }

    try {
      const pageUrls = Array.from({ length: TOTAL_PAGES }, (_, i) => pageUrl(i + 1));
      pageFlip = new window.St.PageFlip(el.book, {
        width: 1000,
        height: 707,
        size: 'stretch',
        minWidth: 280,
        maxWidth: 1180,
        minHeight: 198,
        maxHeight: 835,
        maxShadowOpacity: 0.38,
        showCover: true,
        mobileScrollSupport: false,
        usePortrait: true,
        autoSize: true,
        drawShadow: true,
        flippingTime: matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 620,
        clickEventForward: true,
        swipeDistance: 22,
        showPageCorners: true,
        disableFlipByClick: false
      });

      pageFlip.on('init', () => {
        el.loading.hidden = true;
        el.bookWrap.hidden = false;
        goToPage(currentPage);
        showToast(currentPage > 1 ? `Tiếp tục từ trang ${currentPage}` : 'Vuốt hoặc chạm mép trang để lật sách', 2600);
      });

      pageFlip.on('flip', (event) => updatePageUI(Number(event.data) + 1));
      pageFlip.on('changeOrientation', () => {
        window.setTimeout(() => {
          try { pageFlip?.update?.(); } catch (_) {}
        }, 80);
      });

      pageFlip.loadFromImages(pageUrls);
    } catch (error) {
      console.error('Flipbook init error:', error);
      startFallback('Đã chuyển sang chế độ đọc đơn trang tương thích.');
    }
  }

  el.fallbackImage.addEventListener('error', () => {
    if (effectiveMode === 'local' && el.fallbackImage.dataset.remoteFallback !== '1') {
      el.fallbackImage.dataset.remoteFallback = '1';
      el.fallbackImage.src = remoteUrl(currentPage);
      return;
    }
    setLoadingError('Không tải được ảnh trang', 'Nguồn ảnh hiện không phản hồi. Có thể tải ảnh về thư mục pages/ và mở bằng ?source=local.');
  });

  async function boot() {
    el.pageTotal.textContent = String(TOTAL_PAGES);
    el.progressTotal.textContent = String(TOTAL_PAGES);
    el.pageRange.max = String(TOTAL_PAGES);
    bindControls();
    await resolveSourceMode();
    buildThumbnails();
    initFlipbook();
  }

  boot();
})();
