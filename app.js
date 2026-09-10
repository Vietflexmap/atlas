(() => {
  'use strict';

  const PDF_URL = './Atlas_Vietnam_1996.pdf';
  const EXPECTED_PAGES = 172;
  const STORAGE_KEY = 'vietflexmap-atlas-page';
  const PAGE_W = 508;
  const PAGE_H = 675;

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $('app'), stage: $('stage'), book: $('book'), bookShell: $('bookShell'),
    loadingCard: $('loadingCard'), loadingTitle: $('loadingTitle'), loadingText: $('loadingText'), loadingBar: $('loadingBar'),
    toc: $('tocBtn'), drawer: $('drawer'), scrim: $('drawerScrim'), closeDrawer: $('closeDrawerBtn'), thumbGrid: $('thumbGrid'), drawerTitle: $('drawerTitle'),
    first: $('firstBtn'), prev: $('prevBtn'), next: $('nextBtn'), last: $('lastBtn'), edgePrev: $('edgePrev'), edgeNext: $('edgeNext'),
    input: $('pageInput'), total: $('pageTotal'), range: $('pageRange'), seekCurrent: $('seekCurrent'), seekTotal: $('seekTotal'),
    zoomIn: $('zoomInBtn'), zoomOut: $('zoomOutBtn'), zoomReset: $('zoomResetBtn'), zoomValue: $('zoomValue'),
    fullscreen: $('fullscreenBtn'), focus: $('focusBtn'), download: $('downloadPdf'), toast: $('toast')
  };

  let pdf = null;
  let totalPages = EXPECTED_PAGES;
  let pageFlip = null;
  let currentPage = 1;
  let zoom = 1;
  let drawerOpen = false;
  let toastTimer = 0;
  let singleMode = false;
  let singleCanvas = null;
  const pageElements = new Map();
  const renderJobs = new Map();
  const renderedPages = new Set();
  const thumbJobs = new Map();
  let thumbObserver = null;

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const pad = (n) => String(n).padStart(3, '0');

  function showToast(message, ms = 2200) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.hidden = false;
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  function setProgress(percent, text) {
    el.loadingBar.style.width = `${clamp(percent, 0, 100)}%`;
    if (text) el.loadingText.textContent = text;
  }

  function showFatal(title, message) {
    el.loadingCard.hidden = false;
    el.loadingTitle.textContent = title;
    el.loadingText.textContent = message;
    el.loadingBar.style.width = '0%';
    const spinner = el.loadingCard.querySelector('.spinner');
    if (spinner) spinner.style.display = 'none';
    el.bookShell.hidden = true;
    el.download.hidden = true;
  }

  function initialPage() {
    const match = location.hash.match(/page=(\d+)/i);
    if (match) return clamp(Number(match[1]) || 1, 1, totalPages);
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (saved >= 1 && saved <= totalPages) return saved;
    } catch (_) {}
    return 1;
  }

  function updateUI(page, persist = true) {
    currentPage = clamp(Number(page) || 1, 1, totalPages);
    el.input.value = String(currentPage);
    el.range.value = String(currentPage);
    el.seekCurrent.textContent = pad(currentPage);
    const pct = totalPages > 1 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 0;
    el.range.style.background = `linear-gradient(90deg,var(--gold) 0%,var(--gold) ${pct}%,rgba(255,255,255,.12) ${pct}%,rgba(255,255,255,.12) 100%)`;

    const first = currentPage === 1;
    const last = currentPage === totalPages;
    [el.first, el.prev, el.edgePrev].forEach((b) => { b.disabled = first; });
    [el.last, el.next, el.edgeNext].forEach((b) => { b.disabled = last; });

    const active = el.thumbGrid.querySelector('.thumb.active');
    if (active) active.classList.remove('active');
    const next = el.thumbGrid.querySelector(`[data-page="${currentPage}"]`);
    if (next) {
      next.classList.add('active');
      if (drawerOpen) next.scrollIntoView({ block: 'nearest' });
    }

    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, String(currentPage)); } catch (_) {}
    }
    const hash = `#page=${currentPage}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    document.title = `Atlas Việt Nam 1996 — Trang ${currentPage} | Vietflexmap số hóa`;
  }

  function configureTotals() {
    el.total.textContent = String(totalPages);
    el.seekTotal.textContent = String(totalPages);
    el.range.max = String(totalPages);
    el.input.max = String(totalPages);
    el.drawerTitle.textContent = `${totalPages} trang`;
  }

  function createPageElement(pageNumber) {
    const page = document.createElement('div');
    page.className = 'page';
    page.dataset.page = String(pageNumber);
    if (pageNumber === 1 || pageNumber === totalPages) page.dataset.density = 'hard';

    const loader = document.createElement('div');
    loader.className = 'page-loader';
    loader.textContent = `Trang ${pageNumber}`;

    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.setAttribute('aria-label', `Atlas Việt Nam - trang ${pageNumber}`);

    page.append(loader, canvas);
    pageElements.set(pageNumber, { root: page, canvas });
    return page;
  }

  async function renderPage(pageNumber, priority = false) {
    pageNumber = clamp(pageNumber, 1, totalPages);
    if (renderedPages.has(pageNumber)) return;
    if (renderJobs.has(pageNumber)) return renderJobs.get(pageNumber);

    const entry = pageElements.get(pageNumber);
    if (!entry || !pdf) return;

    const job = (async () => {
      try {
        const pdfPage = await pdf.getPage(pageNumber);
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = Math.min(PAGE_W / base.width, PAGE_H / base.height);
        const dpr = Math.min(window.devicePixelRatio || 1, priority ? 2 : 1.65);
        const viewport = pdfPage.getViewport({ scale: fit * dpr });

        entry.canvas.width = Math.max(1, Math.floor(viewport.width));
        entry.canvas.height = Math.max(1, Math.floor(viewport.height));
        entry.canvas.style.width = `${Math.round(base.width * fit)}px`;
        entry.canvas.style.height = `${Math.round(base.height * fit)}px`;

        const ctx = entry.canvas.getContext('2d', { alpha: false });
        ctx.save();
        ctx.fillStyle = '#f1eadb';
        ctx.fillRect(0, 0, entry.canvas.width, entry.canvas.height);
        ctx.restore();

        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        entry.root.classList.add('rendered');
        renderedPages.add(pageNumber);
      } catch (err) {
        console.error(`Render page ${pageNumber}`, err);
        const loader = entry.root.querySelector('.page-loader');
        if (loader) loader.textContent = `Không tải được trang ${pageNumber}`;
      } finally {
        renderJobs.delete(pageNumber);
      }
    })();

    renderJobs.set(pageNumber, job);
    return job;
  }

  function renderAround(pageNumber) {
    const pages = [pageNumber - 2, pageNumber - 1, pageNumber, pageNumber + 1, pageNumber + 2, pageNumber + 3]
      .filter((n) => n >= 1 && n <= totalPages);
    pages.forEach((n, index) => renderPage(n, index < 4));
  }

  async function renderThumb(pageNumber, canvas) {
    if (!pdf || canvas.dataset.rendered === '1') return;
    if (thumbJobs.has(pageNumber)) return thumbJobs.get(pageNumber);
    const job = (async () => {
      try {
        const p = await pdf.getPage(pageNumber);
        const base = p.getViewport({ scale: 1 });
        const cssW = 120;
        const cssH = Math.round(cssW * PAGE_H / PAGE_W);
        const fit = Math.min(cssW / base.width, cssH / base.height);
        const viewport = p.getViewport({ scale: fit });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await p.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
        canvas.dataset.rendered = '1';
      } catch (err) {
        console.warn('thumb', pageNumber, err);
      } finally {
        thumbJobs.delete(pageNumber);
      }
    })();
    thumbJobs.set(pageNumber, job);
    return job;
  }

  function buildThumbs() {
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= totalPages; n++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb';
      btn.dataset.page = String(n);
      btn.setAttribute('aria-label', `Mở trang ${n}`);

      const canvas = document.createElement('canvas');
      canvas.dataset.page = String(n);
      const badge = document.createElement('em');
      badge.textContent = String(n);
      btn.append(canvas, badge);
      btn.addEventListener('click', () => { goToPage(n); closeDrawer(); });
      frag.appendChild(btn);
    }
    el.thumbGrid.replaceChildren(frag);

    thumbObserver?.disconnect();
    thumbObserver = new IntersectionObserver((entries) => {
      for (const item of entries) {
        if (!item.isIntersecting) continue;
        const canvas = item.target;
        renderThumb(Number(canvas.dataset.page), canvas);
        thumbObserver.unobserve(canvas);
      }
    }, { root: el.thumbGrid, rootMargin: '220px 0px' });
    el.thumbGrid.querySelectorAll('canvas').forEach((canvas) => thumbObserver.observe(canvas));
  }

  function buildPages() {
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= totalPages; n++) frag.appendChild(createPageElement(n));
    el.book.replaceChildren(frag);
  }

  function createSingleFallback() {
    singleMode = true;
    pageFlip = null;
    el.book.replaceChildren();
    const page = createPageElement(1);
    page.classList.add('single-page');
    singleCanvas = page.querySelector('canvas');
    el.book.append(page);
  }

  async function renderSingle(pageNumber) {
    if (!singleMode || !pdf) return;
    const page = el.book.querySelector('.page');
    const canvas = singleCanvas;
    page.classList.remove('rendered');
    const loader = page.querySelector('.page-loader');
    loader.textContent = `Trang ${pageNumber}`;
    const p = await pdf.getPage(pageNumber);
    const base = p.getViewport({ scale: 1 });
    const fit = Math.min(PAGE_W / base.width, PAGE_H / base.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = p.getViewport({ scale: fit * dpr });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.round(base.width * fit)}px`;
    canvas.style.height = `${Math.round(base.height * fit)}px`;
    await p.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    page.classList.add('rendered');
  }

  function initPageFlip(startPage) {
    if (!window.St || typeof window.St.PageFlip !== 'function') {
      createSingleFallback();
      return renderSingle(startPage).then(() => showToast('Đang dùng chế độ đọc một trang.'));
    }

    pageFlip = new window.St.PageFlip(el.book, {
      width: PAGE_W,
      height: PAGE_H,
      size: 'stretch',
      minWidth: 260,
      maxWidth: PAGE_W,
      minHeight: 345,
      maxHeight: PAGE_H,
      maxShadowOpacity: 0.36,
      showCover: true,
      mobileScrollSupport: false,
      drawShadow: true,
      flippingTime: 720,
      useMouseEvents: true,
      autoSize: true,
      showPageCorners: true,
      disableFlipByClick: false,
      startPage: startPage - 1
    });

    pageFlip.loadFromHTML(el.book.querySelectorAll('.page'));
    pageFlip.on('flip', (event) => {
      const page = clamp(Number(event.data) + 1, 1, totalPages);
      updateUI(page);
      renderAround(page);
    });
    pageFlip.on('changeOrientation', () => renderAround(currentPage));
    pageFlip.on('changeState', (event) => {
      if (event.data === 'flipping') renderAround(currentPage + 1);
    });

    pageFlip.turnToPage(startPage - 1);
  }

  function goToPage(page) {
    const target = clamp(Number(page) || 1, 1, totalPages);
    updateUI(target);
    renderAround(target);
    if (singleMode) return renderSingle(target);
    pageFlip?.turnToPage(target - 1);
  }

  function prevPage() {
    if (currentPage <= 1) return;
    if (singleMode) return goToPage(currentPage - 1);
    pageFlip?.flipPrev();
  }

  function nextPage() {
    if (currentPage >= totalPages) return;
    if (singleMode) return goToPage(currentPage + 1);
    pageFlip?.flipNext();
  }

  function setZoom(next) {
    zoom = clamp(Math.round(next * 100) / 100, 0.65, 1.8);
    document.documentElement.style.setProperty('--scale', String(zoom));
    el.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  }

  function openDrawer() {
    drawerOpen = true;
    el.drawer.classList.add('open');
    el.drawer.setAttribute('aria-hidden', 'false');
    el.toc.setAttribute('aria-expanded', 'true');
    el.scrim.hidden = false;
    const active = el.thumbGrid.querySelector(`[data-page="${currentPage}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }

  function closeDrawer() {
    drawerOpen = false;
    el.drawer.classList.remove('open');
    el.drawer.setAttribute('aria-hidden', 'true');
    el.toc.setAttribute('aria-expanded', 'false');
    el.scrim.hidden = true;
  }

  function toggleFocus(force) {
    const next = typeof force === 'boolean' ? force : !el.app.classList.contains('focus');
    el.app.classList.toggle('focus', next);
    if (next) closeDrawer();
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) { showToast('Trình duyệt này không hỗ trợ toàn màn hình.'); }
  }

  function bindUI() {
    el.toc.addEventListener('click', () => drawerOpen ? closeDrawer() : openDrawer());
    el.closeDrawer.addEventListener('click', closeDrawer);
    el.scrim.addEventListener('click', closeDrawer);
    el.prev.addEventListener('click', prevPage);
    el.edgePrev.addEventListener('click', prevPage);
    el.next.addEventListener('click', nextPage);
    el.edgeNext.addEventListener('click', nextPage);
    el.first.addEventListener('click', () => goToPage(1));
    el.last.addEventListener('click', () => goToPage(totalPages));
    el.fullscreen.addEventListener('click', toggleFullscreen);
    el.focus.addEventListener('click', () => toggleFocus());
    el.zoomIn.addEventListener('click', () => setZoom(zoom + 0.1));
    el.zoomOut.addEventListener('click', () => setZoom(zoom - 0.1));
    el.zoomReset.addEventListener('click', () => setZoom(1));

    el.input.addEventListener('change', () => goToPage(el.input.value));
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { goToPage(el.input.value); el.input.blur(); }
    });
    el.range.addEventListener('input', () => {
      const page = clamp(Number(el.range.value), 1, totalPages);
      el.seekCurrent.textContent = pad(page);
      el.input.value = String(page);
    });
    el.range.addEventListener('change', () => goToPage(el.range.value));

    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevPage(); }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); nextPage(); }
      if (e.key === 'Home') goToPage(1);
      if (e.key === 'End') goToPage(totalPages);
      if (e.key.toLowerCase() === 'f') toggleFullscreen();
      if (e.key.toLowerCase() === 'm') toggleFocus();
      if (e.key === '+' || e.key === '=') setZoom(zoom + 0.1);
      if (e.key === '-') setZoom(zoom - 0.1);
      if (e.key === '0') setZoom(1);
      if (e.key === 'Escape') { if (drawerOpen) closeDrawer(); else toggleFocus(false); }
    });

    el.stage.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });

    window.addEventListener('hashchange', () => {
      const m = location.hash.match(/page=(\d+)/i);
      if (m && Number(m[1]) !== currentPage) goToPage(Number(m[1]));
    });

    document.addEventListener('fullscreenchange', () => {
      el.fullscreen.textContent = document.fullscreenElement ? '×' : '⛶';
    });
  }

  async function boot() {
    bindUI();
    if (!window.pdfjsLib) return showFatal('Thiếu PDF.js', 'Không tải được thư viện PDF.js. Hãy kiểm tra kết nối Internet.');

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

    try {
      const task = window.pdfjsLib.getDocument({ url: PDF_URL, disableAutoFetch: false, disableStream: false });
      task.onProgress = ({ loaded, total }) => {
        if (!total) return setProgress(18, 'Đang nhận dữ liệu PDF…');
        setProgress(Math.min(68, Math.round((loaded / total) * 68)), `Đang tải PDF… ${Math.round((loaded / total) * 100)}%`);
      };
      pdf = await task.promise;
      totalPages = pdf.numPages;
      configureTotals();

      if (totalPages !== EXPECTED_PAGES) showToast(`PDF hiện có ${totalPages} trang; thiết kế chuẩn dự kiến ${EXPECTED_PAGES} trang.`, 5000);

      setProgress(76, 'Đang dựng cấu trúc sách HTML5…');
      buildPages();
      buildThumbs();

      currentPage = initialPage();
      updateUI(currentPage, false);
      setProgress(86, 'Đang render các trang đầu tiên…');
      await Promise.all([renderPage(currentPage, true), renderPage(Math.min(currentPage + 1, totalPages), true)]);

      setProgress(94, 'Đang khởi tạo hiệu ứng lật trang…');
      await initPageFlip(currentPage);
      renderAround(currentPage);

      el.loadingCard.hidden = true;
      el.bookShell.hidden = false;
      el.download.hidden = false;
      setProgress(100);
    } catch (err) {
      console.error(err);
      showFatal('Chưa có Atlas_Vietnam_1996.pdf', 'Đặt file PDF 172 trang vào thư mục gốc của repository. Flipbook sẽ tự đọc PDF bằng PDF.js, không cần 172 ảnh rời.');
    }
  }

  boot();
})();
