/* Booth Contact Scanner — barcode decode + OCR, fully client-side. */
(() => {
  'use strict';

  // ---- Elements ----------------------------------------------------------
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const captureBtn = document.getElementById('captureBtn');
  const saveBtn = document.getElementById('saveBtn');
  const discardBtn = document.getElementById('discardBtn');
  const exportBtn = document.getElementById('exportBtn');
  const snapshot = document.getElementById('snapshot');
  const ocrChips = document.getElementById('ocrChips');
  const listEl = document.getElementById('list');
  const countEl = document.getElementById('count');
  const listCountEl = document.getElementById('listCount');
  const imgModal = document.getElementById('imgModal');
  const modalImg = document.getElementById('modalImg');
  const modalClose = document.getElementById('modalClose');

  const fields = {
    name: document.getElementById('f_name'),
    title: document.getElementById('f_title'),
    company: document.getElementById('f_company'),
    barcode: document.getElementById('f_barcode'),
  };

  const views = {
    scanView: document.getElementById('scanView'),
    reviewView: document.getElementById('reviewView'),
    listView: document.getElementById('listView'),
  };

  // ---- State -------------------------------------------------------------
  const STORE_KEY = 'booth_contacts_v1'; // legacy localStorage key (migrated once)
  let contacts = [];
  let codeReader = null;
  let lastBarcode = '';
  let lastImage = '';   // downscaled JPEG of the most recent capture
  let selectedChip = null;

  // Lines we never want to treat as name/title/company (badge boilerplate).
  const NOISE = /(^(government|service|delivery|exhibitor|attendee|visitor|delegate|sponsor|partner)$)|event partner|event location|convention center|^\d|place nw|washington, dc/i;

  // ---- View switching ----------------------------------------------------
  function show(viewName) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== viewName));
    document.querySelectorAll('.tab[data-view]').forEach((t) =>
      t.classList.toggle('active', t.dataset.view === viewName));
    // While reviewing a capture, hide the bottom tab bar so it can't cover the
    // Save/Discard buttons — those become a pinned footer instead.
    document.body.classList.toggle('reviewing', viewName === 'reviewView');
    if (viewName === 'listView') renderList();
  }
  document.querySelectorAll('.tab[data-view]').forEach((t) =>
    t.addEventListener('click', () => show(t.dataset.view)));

  // ---- Camera + continuous barcode scan ----------------------------------
  async function startCamera() {
    try {
      status.textContent = 'Starting camera…';
      codeReader = new ZXing.BrowserMultiFormatReader();

      // Request the rear camera at high resolution — the default ZXing stream
      // is low-res, which is the main reason OCR struggles. A sharper frame =
      // a far better read.
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
      };

      await codeReader.decodeFromConstraints(constraints, video, (result) => {
        if (result) {
          const text = result.getText();
          if (text && text !== lastBarcode) {
            lastBarcode = text;
            status.textContent = `Barcode: ${text} — tap “Capture badge”`;
            status.classList.add('found');
            vibrate(60);
          }
        }
      });

      startBtn.textContent = 'Camera running';
      startBtn.disabled = true;
      captureBtn.disabled = false;
      if (!lastBarcode) status.textContent = 'Searching for barcode…';

      initOcr(); // warm up the OCR engine in the background
    } catch (err) {
      console.error(err);
      status.textContent = 'Camera error: ' + (err && err.message || err) +
        ' (a secure HTTPS origin is required).';
    }
  }

  // ---- OCR engine (persistent worker, warmed once) -----------------------
  let ocrWorker = null;
  let ocrReady = null;
  function initOcr() {
    if (ocrReady) return ocrReady;
    ocrReady = (async () => {
      ocrWorker = await Tesseract.createWorker('eng');
      // PSM 4 = single column of text of variable sizes — matches a badge's
      // stacked, centred lines (big name, smaller title/company).
      await ocrWorker.setParameters({ tessedit_pageseg_mode: '4' });
      return ocrWorker;
    })();
    return ocrReady;
  }

  // ---- Capture frame + OCR ------------------------------------------------
  async function captureBadge() {
    if (!video.videoWidth) return;
    captureBtn.disabled = true;
    captureBtn.textContent = 'Reading…';

    // Grab the current frame at full sensor resolution.
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    snapshot.src = canvas.toDataURL('image/jpeg', 0.85);

    // Keep a colour, downscaled copy of the badge photo to store with the contact.
    lastImage = makeStoredImage(canvas);

    // Build a cleaned-up copy for OCR: upscaled, grayscale, high-contrast.
    const ocrCanvas = preprocess(canvas);

    status.textContent = 'Running OCR…';
    let lines = [];
    try {
      await initOcr();
      const { data } = await ocrWorker.recognize(ocrCanvas);
      lines = (data.text || '')
        .split('\n')
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length > 1);
    } catch (err) {
      console.error('OCR failed', err);
    }

    populateReview(lines, lastBarcode);
    captureBtn.disabled = false;
    captureBtn.textContent = 'Capture badge';
    show('reviewView');
  }

  // Upscale small frames, convert to grayscale, and boost contrast — this is
  // where most of the OCR accuracy gain comes from.
  function preprocess(src) {
    const targetW = 2000;
    const scale = Math.max(1, targetW / src.width);
    const w = Math.round(src.width * scale);
    const h = Math.round(src.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const contrast = 1.5;          // >1 sharpens dark-text-on-white
    const intercept = 128 * (1 - contrast);
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g = g * contrast + intercept;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Colour, downscaled JPEG for storage/export (keeps DB small but readable).
  function makeStoredImage(src) {
    const maxW = 1100;
    const scale = Math.min(1, maxW / src.width);
    const w = Math.round(src.width * scale);
    const h = Math.round(src.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.8);
  }

  // ---- Heuristic field guessing ------------------------------------------
  function populateReview(lines, barcode) {
    fields.barcode.value = barcode || '';
    fields.name.value = '';
    fields.title.value = '';
    fields.company.value = '';

    // Candidate lines = OCR lines minus obvious noise and code-like tokens.
    // NOTE: only drop alphanumeric tokens that CONTAIN A DIGIT (e.g. the
    // barcode "LI300178"). All-caps words like "PEDRO LIMA" or "WORK DYNAMICS"
    // must be KEPT — they are exactly what we want.
    const candidates = lines.filter((l) => {
      const compact = l.replace(/\s/g, '');
      if (NOISE.test(l)) return false;
      if (l === barcode) return false;
      if (/\d/.test(compact) && /^[A-Z0-9]{4,}$/.test(compact)) return false; // code token
      if (!/[A-Za-z]/.test(l)) return false; // no letters at all
      return true;
    });

    // Best-effort: first plausible line = name, then title, then company.
    if (candidates[0]) fields.name.value = titleCase(candidates[0]);
    if (candidates[1]) fields.title.value = titleCase(candidates[1]);
    if (candidates[2]) fields.company.value = titleCase(candidates[2]);

    renderChips(lines);
  }

  // Tap a chip to select an OCR line, then tap a field to assign it.
  function renderChips(lines) {
    ocrChips.innerHTML = '';
    selectedChip = null;
    lines.forEach((line) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = line;
      chip.addEventListener('click', () => {
        ocrChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedChip = line;
      });
      ocrChips.appendChild(chip);
    });
  }
  Object.values(fields).forEach((input) => {
    input.addEventListener('focus', () => {
      if (selectedChip) {
        input.value = titleCase(selectedChip);
        ocrChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
        selectedChip = null;
        input.blur();
      }
    });
  });

  // ---- Save / discard ----------------------------------------------------
  async function saveContact() {
    const c = {
      id: cryptoId(),
      name: fields.name.value.trim(),
      title: fields.title.value.trim(),
      company: fields.company.value.trim(),
      barcode: fields.barcode.value.trim(),
      image: lastImage || '',
      scannedAt: new Date().toISOString(),
    };
    if (!c.name && !c.company && !c.barcode) {
      alert('Nothing to save — fill in at least one field.');
      return;
    }
    contacts.push(c);
    updateCount();
    try {
      await idbPut(c);
    } catch (err) {
      console.error('Save failed', err);
      alert('Could not save to device storage: ' + (err && err.message || err));
    }
    resetScan();
    show('scanView');
  }

  function resetScan() {
    lastBarcode = '';
    lastImage = '';
    status.classList.remove('found');
    status.textContent = codeReader ? 'Searching for barcode…' : 'Tap “Start camera” to begin';
  }

  // ---- Saved list --------------------------------------------------------
  function renderList() {
    listCountEl.textContent = contacts.length;
    listEl.innerHTML = '';
    if (!contacts.length) {
      listEl.innerHTML = '<p class="empty">No contacts yet. Scan a badge to get started.</p>';
      return;
    }
    [...contacts].reverse().forEach((c) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        `<div class="name">${esc(c.name) || '(no name)'}</div>` +
        `<div class="meta">${esc(c.title)}${c.title && c.company ? ' · ' : ''}${esc(c.company)}</div>` +
        `<div class="bc">${esc(c.barcode)}</div>` +
        (c.image ? `<img class="thumb" src="${c.image}" alt="badge" />` : '') +
        `<button class="del" data-id="${c.id}" aria-label="Delete">✕</button>`;

      const thumb = card.querySelector('.thumb');
      if (thumb) thumb.addEventListener('click', () => openImage(c.image));

      card.querySelector('.del').addEventListener('click', async () => {
        if (!confirm('Delete this contact?')) return;
        contacts = contacts.filter((x) => x.id !== c.id);
        updateCount();
        try { await idbDelete(c.id); } catch (err) { console.error(err); }
        renderList();
      });
      listEl.appendChild(card);
    });
  }

  // ---- Full-screen image viewer ------------------------------------------
  function openImage(src) {
    modalImg.src = src;
    imgModal.classList.remove('hidden');
  }
  function closeImage() {
    imgModal.classList.add('hidden');
    modalImg.src = '';
  }
  modalClose.addEventListener('click', closeImage);
  imgModal.addEventListener('click', (e) => { if (e.target === imgModal) closeImage(); });

  // ---- Export ------------------------------------------------------------
  // Builds a ZIP containing contacts.csv + a photos/ folder. Falls back to a
  // plain CSV download if JSZip isn't available (e.g. fully offline).
  async function exportData() {
    if (!contacts.length) { alert('No contacts to export yet.'); return; }

    const stamp = new Date().toISOString().slice(0, 10);
    const sorted = [...contacts].sort((a, b) =>
      String(a.scannedAt).localeCompare(String(b.scannedAt)));

    const header = ['Name', 'Job Title', 'Company', 'Barcode', 'Scanned At', 'Photo File'];
    const rows = sorted.map((c, i) => {
      const file = c.image ? imageFileName(c, i) : '';
      return [c.name, c.title, c.company, c.barcode, c.scannedAt, file].map(csvCell).join(',');
    });
    const csv = '﻿' + header.join(',') + '\n' + rows.join('\n');

    const haveImages = sorted.some((c) => c.image);

    if (typeof JSZip === 'undefined' || !haveImages) {
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `booth-contacts-${stamp}.csv`);
      if (haveImages) {
        alert('Photos could not be bundled (need a connection for the ZIP tool). Exported the CSV only.');
      }
      return;
    }

    const zip = new JSZip();
    zip.file('contacts.csv', csv);
    const photos = zip.folder('photos');
    sorted.forEach((c, i) => {
      if (c.image) {
        const b64 = c.image.split(',')[1];
        photos.file(imageFileName(c, i), b64, { base64: true });
      }
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `booth-contacts-${stamp}.zip`);
  }

  function imageFileName(c, i) {
    const base = (c.barcode || c.name || 'badge')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'badge';
    return `${String(i + 1).padStart(3, '0')}_${base}.jpg`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---- Persistence (IndexedDB — holds text + photos) ---------------------
  const DB_NAME = 'contactScanner';
  const STORE = 'contacts';
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function idbGetAll() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(rec) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDelete(id) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadContacts() {
    let list = [];
    try { list = await idbGetAll(); } catch (err) { console.error('DB load failed', err); }
    // One-time migration of any contacts saved by the old localStorage version.
    if (!list.length) {
      try {
        const old = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        if (old.length) {
          for (const c of old) await idbPut(c);
          list = old;
          localStorage.removeItem(STORE_KEY);
        }
      } catch { /* ignore */ }
    }
    list.sort((a, b) => String(a.scannedAt).localeCompare(String(b.scannedAt)));
    return list;
  }
  function updateCount() {
    countEl.textContent = `${contacts.length} saved`;
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function titleCase(s) {
    // Only re-case ALL-CAPS lines; leave mixed-case as typed.
    if (s === s.toUpperCase()) {
      return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return s;
  }
  function cryptoId() {
    return (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.round(Math.random() * 1e6);
  }
  function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

  // ---- Wire up -----------------------------------------------------------
  startBtn.addEventListener('click', startCamera);
  captureBtn.addEventListener('click', captureBadge);
  saveBtn.addEventListener('click', saveContact);
  discardBtn.addEventListener('click', () => { resetScan(); show('scanView'); });
  exportBtn.addEventListener('click', exportData);

  // Load saved contacts from the database, then show the count.
  (async () => {
    contacts = await loadContacts();
    updateCount();
  })();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
