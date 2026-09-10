(() => {
  'use strict';

  const PDF_URL = './Atlas_Vietnam_1996.pdf';
  const REMOTE_BASE = 'https://www.bandovn.vn/onlinescan/atlasvietnam/files/mobile';
  const SOURCE_VIEWER = 'https://www.bandovn.vn/onlinescan/atlasvietnam/';
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
  let mode = 'boot'; // pdf | remote | single-pdf | single-remote
  let totalPages = EXPECTED_PAGES;
  let pageFlip = null;
  let currentPage = 1;
  let zoom = 1;
  let drawerOpen = false;
  let toastTimer = 0;
  let singleCanvas = null;
  let singleImage = null;
  const pageElements = new Map();
  const renderJobs = new Map();
  const renderedPages = new Set();
  const thumbJobs = new Map();
  let thumbObserver = null;

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const pad = (n) => String(n).padStart(3, '0');
  const remoteUrl = (n) => `${REMOTE_BASE}/${n}.jpg`;

  function injectRuntimeStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .page.remote-page{background:#eee7d7;overflow:hidden;position:relative}
      .page.remote-page>img,.single-remote-image{width:100%;height:100%;display:block;object-fit:contain;background:#eee7d7}
      .thumb>img{width:100%;height:100%;display:block;object-fit:cover;background:#d9d2c3}
      .recovery-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:7px}
      .recovery-btn{border:1px solid rgba(210,173,107,.55);border-radius:10px;background:rgba(210,173,107,.12);color:#f4f0e7;padding:9px 13px;cursor:pointer;font-weight:700;font-size:12px;text-decoration:none}
      .recovery-btn.secondary{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.05);font-weight:600}
      .source-mode-pill{position:absolute;right:14px;bottom:12px;z-index:15;padding:4px 8px;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:rgba(10,9,8,.52);color:rgba(255,255,255,.48);font-size:9px;pointer-events:none}
      @media(max-width:560px){.recovery-actions{display:grid;width:100%}.recovery-btn{text-align:center}}
    `;
    document.head.appendChild(style);
  }

  function showToast(message, ms = 2500) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.hidden = false;
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  function setProgress(percent, text) {
    el.loadingBar.style.width = `${clamp(percent, 0, 100)}%`;
    if (text) el.loadingText.textContent = text;
  }

  function setLoading(title, text, percent = 0) {
    el.loadingCard.hidden = false;
    el.loadingTitle.textContent = title;
    el.loadingText.textContent = text;
    setProgress(percent);
    const spinner = el.loadingCard.querySelector('.spinner');
    if (spinner) spinner.style.display = '';
    el.loadingCard.querySelector('.recovery-actions')?.remove();
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

    const atFirst = currentPage <= 1;
    const atLast = currentPage >= totalPages;
    [el.first, el.prev, el.edgePrev].forEach((b) => { if (b) b.disabled = atFirst; });
    [el.last, el.next, el.edgeNext].forEach((b) => { if (b) b.disabled = atLast; });

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

  function destroyBook() {
    try { pageFlip?.destroy?.(); } catch (_) {}
    pageFlip = null;
    thumbObserver?.disconnect();
    thumbObserver = null;
    pageElements.clear();
    renderJobs.clear();
    renderedPages.clear();
    thumbJobs.clear();
    el.book.replaceChildren();
    el.thumbGrid.replaceChildren();
    singleCanvas = null;
    singleImage = null;
  }

  function createPdfPageElement(pageNumber) {
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

  async function renderPdfPage(pageNumber, priority = false) {
    pageNumber = clamp(pageNumber, 1, totalPages);
    if (!pdf || renderedPages.has(pageNumber)) return;
    if (renderJobs.has(pageNumber)) return renderJobs.get(pageNumber);
    const entry = pageElements.get(pageNumber);
    if (!entry) return;

    const job = (async () => {
      try {
        const pdfPage = await pdf.getPage(pageNumber);
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = Math.min(PAGE_W / base.width, PAGE_H / base.height);
        const dpr = Math.min(window.devicePixelRatio || 1, priority ? 2 : 1.6);
        const viewport = pdfPage.getViewport({ scale: fit * dpr });
        entry.canvas.width = Math.max(1, Math.floor(viewport.width));
        entry.canvas.height = Math.max(1, Math.floor(viewport.height));
        entry.canvas.style.width = `${Math.round(base.width * fit)}px`;
        entry.canvas.style.height = `${Math.round(base.height * fit)}px`;
        const ctx = entry.canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#f1eadb';
        ctx.fillRect(0, 0, entry.canvas.width, entry.canvas.height);
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        entry.root.classList.add('rendered');
        renderedPages.add(pageNumber);
      } catch (err) {
        console.error(`Render PDF page ${pageNumber}`, err);
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
    if (!pdf) return;
    [pageNumber - 2, pageNumber - 1, pageNumber, pageNumber + 1, pageNumber + 2, pageNumber + 3]
      .filter((n) => n >= 1 && n <= totalPages)
      .forEach((n, i) => renderPdfPage(n, i < 4));
  }

  async function renderPdfThumb(pageNumber, canvas) {
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
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#eee7d7';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await p.render({ canvasContext: ctx, viewport }).promise;
        canvas.dataset.rendered = '1';
      } catch (err) {
        console.warn('thumbnail', pageNumber, err);
      } finally {
        thumbJobs.delete(pageNumber);
      }
    })();
    thumbJobs.set(pageNumber, job);
    return job;
  }

  function buildPdfThumbs() {
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
    thumbObserver = new IntersectionObserver((entries) => {
      for (const item of entries) {
        if (!item.isIntersecting) continue;
        renderPdfThumb(Number(item.target.dataset.page), item.target);
        thumbObserver.unobserve(item.target);
      }
    }, { root: el.thumbGrid, rootMargin: '220px 0px' });
    el.thumbGrid.querySelectorAll('canvas').forEach((canvas) => thumbObserver.observe(canvas));
  }

  function buildPdfPages() {
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= totalPages; n++) frag.appendChild(createPdfPageElement(n));
    el.book.replaceChildren(frag);
  }

  function createRemotePageElement(pageNumber) {
    const page = document.createElement('div');
    page.className = 'page remote-page';
    page.dataset.page = String(pageNumber);
    if (pageNumber === 1 || pageNumber === totalPages) page.dataset.density = 'hard';

    const loader = document.createElement('div');
    loader.className = 'page-loader';
    loader.textContent = `Trang ${pageNumber}`;
    const img = document.createElement('img');
    img.alt = `Atlas Việt Nam - trang ${pageNumber}`;
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.loading = pageNumber <= 6 ? 'eager' : 'lazy';
    img.src = remoteUrl(pageNumber);
    img.addEventListener('load', () => page.classList.add('rendered'), { once: true });
    img.addEventListener('error', () => { loader.textContent = `Không tải được trang ${pageNumber}`; }, { once: true });
    page.append(loader, img);
    return page;
  }

  function buildRemotePages() {
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= totalPages; n++) frag.appendChild(createRemotePageElement(n));
    el.book.replaceChildren(frag);
  }

  function buildRemoteThumbs() {
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= totalPages; n++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb';
      btn.dataset.page = String(n);
      btn.setAttribute('aria-label', `Mở trang ${n}`);
      const img = document.createElement('img');
      img.alt = `Trang ${n}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = remoteUrl(n);
      const badge = document.createElement('em');
      badge.textContent = String(n);
      btn.append(img, badge);
      btn.addEventListener('click', () => { goToPage(n); closeDrawer(); });
      frag.appendChild(btn);
    }
    el.thumbGrid.replaceChildren(frag);
  }

  function createPageFlip(startPage) {
    if (!window.St || typeof window.St.PageFlip !== 'function') return false;
    pageFlip = new window.St.PageFlip(el.book, {
      width: PAGE_W,
      height: PAGE_H,
      size: 'stretch',
      minWidth: 250,
      maxWidth: PAGE_W,
      minHeight: 332,
      maxHeight: PAGE_H,
      maxShadowOpacity: 0.38,
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
    pageFlip.on('changeState', (event) => {
      if (event.data === 'flipping') renderAround(currentPage + 1);
    });
    pageFlip.turnToPage(startPage - 1);
    return true;
  }

  async function createSinglePdf(startPage) {
    mode = 'single-pdf';
    el.book.replaceChildren();
    const page = document.createElement('div');
    page.className = 'page single-page';
    const loader = document.createElement('div');
    loader.className = 'page-loader';
    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    page.append(loader, canvas);
    el.book.append(page);
    singleCanvas = canvas;
    await renderSinglePdf(startPage);
  }

  async function renderSinglePdf(pageNumber) {
    if (!pdf || !singleCanvas) return;
    const p = await pdf.getPage(pageNumber);
    const base = p.getViewport({ scale: 1 });
    const fit = Math.min(PAGE_W / base.width, PAGE_H / base.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = p.getViewport({ scale: fit * dpr });
    singleCanvas.width = Math.floor(viewport.width);
    singleCanvas.height = Math.floor(viewport.height);
    singleCanvas.style.width = `${Math.round(base.width * fit)}px`;
    singleCanvas.style.height = `${Math.round(base.height * fit)}px`;
    const ctx = singleCanvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#eee7d7';
    ctx.fillRect(0, 0, singleCanvas.width, singleCanvas.height);
    await p.render({ canvasContext: ctx, viewport }).promise;
    el.book.querySelector('.page')?.classList.add('rendered');
  }

  function createSingleRemote(startPage) {
    mode = 'single-remote';
    el.book.replaceChildren();
    const page = document.createElement('div');
    page.className = 'page remote-page rendered';
    const img = document.createElement('img');
    img.className = 'single-remote-image';
    img.referrerPolicy = 'no-referrer';
    page.append(img);
    el.book.append(page);
    singleImage = img;
    renderSingleRemote(startPage);
  }

  function renderSingleRemote(pageNumber) {
    if (!singleImage) return;
    singleImage.alt = `Atlas Việt Nam - trang ${pageNumber}`;
    singleImage.src = remoteUrl(pageNumber);
  }

  function goToPage(page) {
    const target = clamp(Number(page) || 1, 1, totalPages);
    updateUI(target);
    if (mode === 'pdf') renderAround(target);
    if (mode === 'single-pdf') return renderSinglePdf(target);
    if (mode === 'single-remote') return renderSingleRemote(target);
    pageFlip?.turnToPage(target - 1);
  }

  function prevPage() {
    if (currentPage <= 1) return;
    if (mode.startsWith('single')) return goToPage(currentPage - 1);
    pageFlip?.flipPrev();
  }

  function nextPage() {
    if (currentPage >= totalPages) return;
    if (mode.startsWith('single')) return goToPage(currentPage + 1);
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
    el.thumbGrid.querySelector(`[data-page="${currentPage}"]`)?.scrollIntoView({ block: 'nearest' });
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
    el.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { goToPage(el.input.value); el.input.blur(); }
    });
    el.range.addEventListener('input', () => {
      const preview = clamp(Number(el.range.value), 1, totalPages);
      el.seekCurrent.textContent = pad(preview);
      el.input.value = String(preview);
    });
    el.range.addEventListener('change', () => goToPage(el.range.value));

    document.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); prevPage(); }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); nextPage(); }
      if (event.key === 'Home') goToPage(1);
      if (event.key === 'End') goToPage(totalPages);
      if (event.key.toLowerCase() === 'f') toggleFullscreen();
      if (event.key.toLowerCase() === 'm') toggleFocus();
      if (event.key === '+' || event.key === '=') setZoom(zoom + 0.1);
      if (event.key === '-') setZoom(zoom - 0.1);
      if (event.key === '0') setZoom(1);
      if (event.key === 'Escape' && drawerOpen) closeDrawer();
    });

    window.addEventListener('hashchange', () => {
      const match = location.hash.match(/page=(\d+)/i);
      if (match && Number(match[1]) !== currentPage) goToPage(Number(match[1]));
    });

    document.addEventListener('fullscreenchange', () => {
      el.fullscreen.textContent = document.fullscreenElement ? '×' : '⛶';
    });
  }

  function testRemoteImage(timeout = 7000) {
    return new Promise((resolve) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      const timer = setTimeout(() => { img.onload = img.onerror = null; resolve(false); }, timeout);
      img.onload = () => { clearTimeout(timer); resolve(true); };
      img.onerror = () => { clearTimeout(timer); resolve(false); };
      img.src = remoteUrl(1);
    });
  }

  async function loadPdfFromUrl() {
    const task = window.pdfjsLib.getDocument({ url: PDF_URL, disableAutoFetch: false, disableStream: false });
    task.onProgress = ({ loaded, total }) => {
      if (!total) return setProgress(18, 'Đang nhận dữ liệu PDF…');
      setProgress(Math.min(68, Math.round((loaded / total) * 68)), `Đang tải PDF… ${Math.round((loaded / total) * 100)}%`);
    };
    return task.promise;
  }

  async function loadPdfFromFile(file) {
    setLoading('Đang mở PDF từ máy…', 'Kiểm tra cấu trúc Atlas và chuẩn bị Flipbook.', 12);
    const buffer = await file.arrayBuffer();
    const task = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    return task.promise;
  }

  async function startPdfMode(documentPdf, repositoryPdf = false) {
    destroyBook();
    pdf = documentPdf;
    mode = 'pdf';
    totalPages = pdf.numPages;
    configureTotals();
    if (totalPages !== EXPECTED_PAGES) showToast(`PDF có ${totalPages} trang; chuẩn Atlas này dự kiến ${EXPECTED_PAGES} trang.`, 5000);

    setProgress(76, 'Đang dựng cấu trúc sách HTML5…');
    buildPdfPages();
    buildPdfThumbs();
    const startPage = initialPage();
    updateUI(startPage, false);
    setProgress(88, 'Đang render các trang đầu tiên…');
    await Promise.all([renderPdfPage(startPage, true), renderPdfPage(Math.min(startPage + 1, totalPages), true)]);

    if (!createPageFlip(startPage)) await createSinglePdf(startPage);
    renderAround(startPage);
    el.loadingCard.hidden = true;
    el.bookShell.hidden = false;
    el.download.hidden = !repositoryPdf;
    setProgress(100);
    showToast(repositoryPdf ? 'Đang đọc PDF 172 trang từ Vietflexmap.' : 'Đang đọc PDF 172 trang từ máy của bạn.');
  }

  async function startRemoteMode() {
    setLoading('Đang chuyển sang bản số hóa trực tuyến…', 'PDF local chưa có; đang kiểm tra 172 ảnh Atlas.', 22);
    const available = await testRemoteImage();
    if (!available) throw new Error('Remote image source unavailable');

    destroyBook();
    pdf = null;
    mode = 'remote';
    totalPages = EXPECTED_PAGES;
    configureTotals();
    buildRemotePages();
    buildRemoteThumbs();
    const startPage = initialPage();
    updateUI(startPage, false);
    if (!createPageFlip(startPage)) createSingleRemote(startPage);
    el.loadingCard.hidden = true;
    el.bookShell.hidden = false;
    el.download.hidden = true;
    showToast('Đang dùng bản số hóa 172 trang trực tuyến.');
  }

  function showRecovery() {
    setLoading('Atlas đã sẵn sàng để nạp PDF', 'Nguồn ảnh trực tuyến hiện không cho phép nhúng. Chọn file Atlas_Vietnam_1996.pdf (172 trang) trên máy để mở ngay.', 0);
    const spinner = el.loadingCard.querySelector('.spinner');
    if (spinner) spinner.style.display = 'none';
    const actions = document.createElement('div');
    actions.className = 'recovery-actions';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const localPdf = await loadPdfFromFile(file);
        await startPdfMode(localPdf, false);
      } catch (err) {
        console.error(err);
        showToast('Không thể mở file PDF này.', 4000);
      }
    });

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'recovery-btn';
    choose.textContent = 'Mở PDF 172 trang từ máy';
    choose.addEventListener('click', () => input.click());

    const source = document.createElement('a');
    source.className = 'recovery-btn secondary';
    source.href = SOURCE_VIEWER;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = 'Mở nguồn Atlas';

    actions.append(choose, source, input);
    el.loadingCard.append(actions);
    el.bookShell.hidden = true;
    el.download.hidden = true;
  }

  async function boot() {
    injectRuntimeStyles();
    bindUI();
    configureTotals();
    updateUI(initialPage(), false);

    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      try {
        setLoading('Đang mở Atlas…', 'Đang tìm Atlas_Vietnam_1996.pdf trong Vietflexmap.', 8);
        const repoPdf = await loadPdfFromUrl();
        await startPdfMode(repoPdf, true);
        return;
      } catch (err) {
        console.info('Repository PDF chưa có hoặc không đọc được, chuyển sang ảnh nguồn.', err);
      }
    }

    try {
      await startRemoteMode();
    } catch (err) {
      console.warn('Nguồn ảnh trực tuyến không thể nhúng.', err);
      showRecovery();
    }
  }

  boot();
})();
