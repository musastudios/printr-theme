/* PRINTR artwork uploader + client-side preflight (no framework).
 * Files travel to Shopify as native line item property file inputs (properties[Artwork Front|Back])
 * associated with the product form via the `form` attribute. */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const EXT = ['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'eps'];
const PREVIEWABLE = ['jpg', 'jpeg', 'png'];
const COLORS = { bleed: '#000000', cut: '#e0102b', safe: '#1e6bff' };
let pdfjsPromise;
const loadPdfjs = () => (pdfjsPromise ||= import(PDFJS).then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; }));
const fmt = (s, vars = {}) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
const r2 = (n) => Math.round(n * 100) / 100;

/** Parse a size option like 2" x 3.5", 2 x 3.5 in, 8.5x11, 24 x 36" into inches. */
export function parseSize(str) {
  if (!str) return null;
  const s = String(str).toLowerCase().replace(/[“”″]/g, '"').replace(/,/g, '.');
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?\s*[x×by]+\s*(\d+(?:\.\d+)?)\s*(mm|cm|"|in|inch(?:es)?)?/);
  if (!m) return null;
  let w = parseFloat(m[1]); let h = parseFloat(m[2]);
  if (m[3] === 'mm') { w /= 25.4; h /= 25.4; } else if (m[3] === 'cm') { w /= 2.54; h /= 2.54; }
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Detect JPEG colour space: SOF component count 4 or Adobe APP14 marker => CMYK. */
export function jpegColorSpace(buf) {
  const d = new DataView(buf); let i = 2; let adobe = false;
  if (d.getUint16(0) !== 0xffd8) return 'unknown';
  while (i + 4 < d.byteLength) {
    if (d.getUint8(i) !== 0xff) { i++; continue; }
    const marker = d.getUint8(i + 1); const len = d.getUint16(i + 2);
    if (marker === 0xee && String.fromCharCode(d.getUint8(i + 4), d.getUint8(i + 5), d.getUint8(i + 6), d.getUint8(i + 7), d.getUint8(i + 8)) === 'Adobe') adobe = true;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const comps = d.getUint8(i + 9);
      return comps === 4 || (adobe && comps !== 3 && comps !== 1) ? 'cmyk' : comps === 1 ? 'gray' : adobe ? 'rgb-adobe' : 'rgb';
    }
    i += 2 + len;
  }
  return adobe ? 'cmyk' : 'unknown';
}

class ArtworkUploader extends HTMLElement {
  connectedCallback() {
    const $ = (s) => this.querySelector(s);
    this.t = JSON.parse($('[data-au-strings]').textContent);
    this.variants = JSON.parse($('[data-au-variants]').textContent);
    this.cfg = {
      sides: Math.min(2, Math.max(1, parseInt(this.dataset.sides, 10) || 1)),
      bleed: parseFloat(this.dataset.bleed) || 0.125,
      safe: parseFloat(this.dataset.safe) || 0.125,
      minDpi: parseInt(this.dataset.minDpi, 10) || 300,
      maxBytes: (parseFloat(this.dataset.maxMb) || 20) * 1024 * 1024,
      trimW: parseFloat(this.dataset.trimW) || 0,
      trimH: parseFloat(this.dataset.trimH) || 0,
      sizeIndex: parseInt(this.dataset.sizeIndex, 10)
    };
    this.dialog = $('dialog'); this.canvas = $('[data-au-canvas]'); this.ctx = this.canvas.getContext('2d');
    this.wrap = $('[data-au-wrap]'); this.drop = $('[data-au-drop]');
    this.state = { front: this.blankSide(), back: this.blankSide() };
    this.active = 'front'; this.zoom = 1; this.mask = 0.6; this.showGuides = true; this.showCut = true; this.magnify = false; this.landscape = null;
    this.bind();
    this.setVariant(this.dataset.variant);
    document.addEventListener('variant:change', (e) => { this.setVariant(e.detail.variantId); this.applyGate(); });
    // Capture-phase guard so the theme's ProductForm (and native submit) never fire while blocked.
    document.addEventListener('submit', (e) => this.guard(e), true);
    document.addEventListener('click', (e) => { if (e.target.closest(`#${this.dataset.formId} .shopify-payment-button`) && this.blocked()) { e.preventDefault(); e.stopPropagation(); this.openStudio(); } }, true);
    this.update();
  }
  blankSide() { return { file: null, ext: '', source: null, pxW: 0, pxH: 0, pdf: null, rot: 0, scale: 1, x: 0, y: 0, history: [], issues: [] }; }
  get form() { return document.getElementById(this.dataset.formId); }

  /* ---------- template geometry ---------- */
  setVariant(id) {
    const v = this.variants.find((x) => String(x.id) === String(id)) || this.variants[0];
    let size = this.cfg.trimW && this.cfg.trimH ? { w: this.cfg.trimW, h: this.cfg.trimH } : null;
    if (!size && v) {
      if (this.cfg.sizeIndex >= 0) size = parseSize(v.options[this.cfg.sizeIndex]);
      if (!size) for (const o of v.options) { size = parseSize(o); if (size) break; }
    }
    this.trim = size; if (this.landscape === null && size) this.landscape = size.w > size.h;
    if (size && (size.w > size.h) !== this.landscape) this.trim = { w: size.h, h: size.w };
    ['front', 'back'].forEach((s) => this.state[s].source && this.analyze(s, false));
    this.update();
  }
  get doc() { // full document = trim + bleed on each side
    if (!this.trim) return null;
    const b = this.cfg.bleed; return { w: this.trim.w + 2 * b, h: this.trim.h + 2 * b };
  }

  /* ---------- events ---------- */
  bind() {
    const q = (s) => this.querySelectorAll(s);
    this.querySelector('[data-au-open]').addEventListener('click', () => this.openStudio());
    q('[data-au-close]').forEach((b) => b.addEventListener('click', () => this.dialog.close()));
    this.dialog.addEventListener('close', () => this.querySelector('[data-au-open]').focus());
    q('[data-au-input]').forEach((inp) => inp.addEventListener('change', () => this.onFile(inp.dataset.auInput, inp.files[0])));
    q('[data-au-remove]').forEach((b) => b.addEventListener('click', () => this.removeFile(b.dataset.auRemove)));
    this.querySelector('[data-au-browse]').addEventListener('click', () => this.input(this.active)?.click());
    this.querySelector('[data-au-confirm]').addEventListener('change', () => this.update());
    q('[data-au-tab]').forEach((b) => b.addEventListener('click', () => this.tab(b.dataset.auTab)));
    q('[data-au-act]').forEach((b) => b.addEventListener('click', () => this.act(b.dataset.auAct, b)));
    const scale = this.querySelector('[data-au-scale]');
    scale.addEventListener('pointerdown', () => this.push()); scale.addEventListener('keydown', () => this.push());
    scale.addEventListener('input', () => { this.side.scale = scale.value / 100; this.analyze(this.active, false); this.update(); });
    this.querySelector('[data-au-mask]').addEventListener('input', (e) => { this.mask = e.target.value / 100; this.draw(); });
    const zoom = this.querySelector('[data-au-zoom]');
    zoom.addEventListener('input', () => { this.zoom = zoom.value / 100; this.querySelector('[data-au-zoom-out]').value = `${zoom.value}%`; this.draw(); });
    // drag & drop
    ['dragenter', 'dragover'].forEach((t) => this.wrap.addEventListener(t, (e) => { e.preventDefault(); this.wrap.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => this.wrap.addEventListener(t, () => this.wrap.classList.remove('is-over')));
    this.wrap.addEventListener('drop', (e) => {
      e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
      const inp = this.input(this.active); const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; this.onFile(this.active, f);
    });
    // position by pointer drag
    let start = null;
    this.canvas.addEventListener('pointerdown', (e) => { if (!this.side.source) return; this.push(); start = { x: e.clientX, y: e.clientY, ox: this.side.x, oy: this.side.y }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.magnify) { this.mag = this.toCanvas(e); this.draw(); }
      if (!start) return; const ppi = this.ppi;
      this.side.x = start.ox + (e.clientX - start.x) * this.cssRatio / ppi; this.side.y = start.oy + (e.clientY - start.y) * this.cssRatio / ppi; this.draw();
    });
    const end = () => { if (start) { start = null; this.update(); } };
    this.canvas.addEventListener('pointerup', end); this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointerleave', () => { this.mag = null; this.draw(); });
    // keyboard positioning
    this.canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01; const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (m && this.side.source) { e.preventDefault(); this.push(); this.side.x += m[0]; this.side.y += m[1]; this.update(); }
      else if (e.key === '+' || e.key === '=') this.setScale(this.side.scale * 1.05);
      else if (e.key === '-') this.setScale(this.side.scale / 1.05);
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.act('undo'); }
    });
    window.addEventListener('resize', () => this.dialog.open && this.draw());
  }
  openStudio() { if (!this.dialog.open) this.dialog.showModal(); requestAnimationFrame(() => this.draw()); }
  input(side) { return this.querySelector(`[data-au-input="${side}"]`); }
  get side() { return this.state[this.active === '3d' ? 'front' : this.active]; }
  tab(name) {
    this.querySelectorAll('[data-au-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.auTab === name)));
    this.wrap.classList.toggle('is-3d', name === '3d');
    if (name !== '3d') this.active = name; this.update();
  }
  push() { const s = this.side; s.history.push({ rot: s.rot, scale: s.scale, x: s.x, y: s.y }); if (s.history.length > 50) s.history.shift(); }
  setScale(v) { this.push(); this.side.scale = Math.min(4, Math.max(0.1, v)); this.analyze(this.active, false); this.update(); }
  act(a, btn) {
    const s = this.side;
    switch (a) {
      case 'orientation': this.landscape = !this.landscape; if (this.trim) this.trim = { w: this.trim.h, h: this.trim.w }; ['front', 'back'].forEach((k) => this.state[k].source && this.analyze(k, false)); break;
      case 'rotate': this.push(); s.rot = (s.rot + 90) % 360; this.fit(s); this.analyze(this.active, false); break;
      case 'fit': this.push(); this.fit(s); this.analyze(this.active, false); break;
      case 'undo': { const h = s.history.pop(); if (h) Object.assign(s, h); this.analyze(this.active, false); break; }
      case 'reset': this.push(); s.rot = 0; this.fit(s); this.analyze(this.active, false); break;
      case 'magnify': this.magnify = !this.magnify; btn.setAttribute('aria-pressed', String(this.magnify)); break;
      case 'guides': this.showGuides = !this.showGuides; btn.setAttribute('aria-pressed', String(this.showGuides)); break;
      case 'cut': this.showCut = !this.showCut; btn.setAttribute('aria-pressed', String(this.showCut)); break;
      case 'autorotate': { const k = btn.dataset.side; const t = this.state[k]; this.active = k; this.push(); t.rot = (t.rot + 90) % 360; this.fit(t); this.analyze(k, false); break; }
    }
    this.update();
  }
  /** Scale 1 == art covers trim+bleed exactly (cover fit), centred. */
  fit(s) { s.scale = 1; s.x = 0; s.y = 0; }

  /* ---------- file intake ---------- */
  removeFile(side) {
    const inp = this.input(side); inp.value = ''; this.state[side] = this.blankSide(); this.update(); inp.focus();
  }
  async onFile(side, file) {
    const s = this.blankSide(); this.state[side] = s; s.file = file || null;
    if (!file) return this.update();
    s.ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!EXT.includes(s.ext)) { s.issues = [this.issue('error', 'bad_format', { name: file.name })]; return this.update(); }
    if (file.size > this.cfg.maxBytes) { s.issues = [this.issue('error', 'too_large', { name: file.name, size: r2(file.size / 1048576), max: r2(this.cfg.maxBytes / 1048576) })]; return this.update(); }
    try {
      if (PREVIEWABLE.includes(s.ext)) {
        s.source = await createImageBitmap(file); s.pxW = s.source.width; s.pxH = s.source.height;
        s.color = s.ext === 'png' ? 'rgb' : jpegColorSpace(await file.slice(0, 256 * 1024).arrayBuffer());
      } else if (s.ext === 'pdf') {
        await this.loadPdf(s, file);
      }
    } catch (err) { console.warn('[artwork-uploader]', err); s.loadError = true; }
    this.tab(side); this.analyze(side, true); this.update();
  }
  async loadPdf(s, file) {
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1); const vp = page.getViewport({ scale: 1 });
    s.pdf = { pages: pdf.numPages, wIn: vp.width / 72, hIn: vp.height / 72 };
    const scale = Math.min(4, 2400 / Math.max(vp.width, vp.height));
    const v2 = page.getViewport({ scale }); const c = document.createElement('canvas');
    c.width = Math.ceil(v2.width); c.height = Math.ceil(v2.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: v2 }).promise;
    s.source = c; s.pxW = c.width; s.pxH = c.height;
  }

  /* ---------- preflight ---------- */
  issue(level, key, vars = {}, extra = {}) { return { level, key, text: fmt(this.t[key], vars), ...extra }; }
  analyze(side, autoFit) {
    const s = this.state[side]; if (!s.file) return;
    const doc = this.doc; const out = [];
    if (s.issues.some((i) => i.key === 'bad_format' || i.key === 'too_large')) return;
    const name = s.file.name;
    if (!doc) out.push(this.issue('warning', 'no_template'));
    if (s.ext === 'tif' || s.ext === 'tiff' || s.ext === 'eps') out.push(this.issue('info', 'no_preview', { name }));
    if (s.loadError && s.ext === 'pdf') out.push(this.issue('warning', 'pdf_failed', { name }));
    if (s.loadError && s.ext !== 'pdf') out.push(this.issue('info', 'no_preview', { name }));
    if (autoFit) this.fit(s);
    const rotated = s.rot % 180 !== 0;
    const artW = rotated ? s.pxH : s.pxW; const artH = rotated ? s.pxW : s.pxH;
    if (doc && s.pdf) {
      const pw = rotated ? s.pdf.hIn : s.pdf.wIn; const ph = rotated ? s.pdf.wIn : s.pdf.hIn; const tol = 0.03;
      const vars = { w: r2(pw), h: r2(ph), tw: r2(doc.w), th: r2(doc.h) };
      if (Math.abs(pw - doc.w) <= tol && Math.abs(ph - doc.h) <= tol) out.push(this.issue('ok', 'pdf_ok', vars));
      else if (Math.abs(pw - this.trim.w) <= tol && Math.abs(ph - this.trim.h) <= tol) out.push(this.issue('warning', 'pdf_no_bleed', { ...vars, bleed: this.cfg.bleed }));
      else if (Math.abs(ph - doc.w) <= tol && Math.abs(pw - doc.h) <= tol) out.push(this.issue('warning', 'orientation', { name }, { fix: side }));
      else out.push(this.issue('warning', 'pdf_size', vars));
      if (s.pdf.pages !== this.cfg.sides && !(side === 'front' && s.pdf.pages === 1)) out.push(this.issue('warning', 'pdf_pages', { pages: s.pdf.pages, sides: this.cfg.sides }));
    } else if (doc && s.pxW && !s.pdf) {
      const artLand = artW > artH; const docLand = doc.w > doc.h;
      if (artW !== artH && doc.w !== doc.h && artLand !== docLand) out.push(this.issue('warning', 'orientation', { name }, { fix: side }));
      const ra = artW / artH; const rd = doc.w / doc.h;
      if (artLand === docLand && Math.abs(ra / rd - 1) > 0.02) out.push(this.issue('warning', 'aspect', { ar: r2(ra), tr: r2(rd) }));
      const dpi = Math.floor(this.effectiveDpi(s));
      if (dpi < 150) out.push(this.issue('error', 'dpi_too_low', { dpi, min: this.cfg.minDpi }));
      else if (dpi < this.cfg.minDpi) out.push(this.issue('warning', 'dpi_low', { dpi, min: this.cfg.minDpi }));
      else out.push(this.issue('ok', 'dpi_ok', { dpi }));
      s.dpi = dpi;
      if (s.color === 'cmyk') out.push(this.issue('ok', 'cmyk')); else out.push(this.issue('info', 'rgb'));
    }
    s.issues = out;
  }
  /** Pixels across the inches the art occupies when placed (cover-fit * user scale). */
  effectiveDpi(s) {
    const doc = this.doc; const rotated = s.rot % 180 !== 0;
    const w = rotated ? s.pxH : s.pxW; const h = rotated ? s.pxW : s.pxH;
    const cover = Math.max(doc.w / w, doc.h / h); // inches per pixel at scale 1
    return 1 / (cover * s.scale);
  }
  allIssues() {
    const list = [];
    const needed = this.cfg.sides === 2 ? ['front', 'back'] : ['front'];
    needed.forEach((k) => {
      const s = this.state[k];
      if (!s.file) list.push({ side: k, ...this.issue('error', 'missing_file', { side: this.t[k] }) });
      else s.issues.forEach((i) => list.push({ side: k, ...i }));
    });
    return list;
  }
  blocked() {
    const issues = this.allIssues();
    if (issues.some((i) => i.level === 'error')) return 'blocked';
    if (issues.some((i) => i.level === 'warning') && !this.querySelector('[data-au-confirm]').checked) return 'confirm_needed';
    return false;
  }
  guard(e) {
    if (e.target !== this.form) return;
    const b = this.blocked();
    if (b) { e.preventDefault(); e.stopImmediatePropagation(); this.openStudio(); this.querySelector('[data-au-status]').textContent = this.t[b]; }
  }
  applyGate() {
    const btn = this.form?.querySelector('[type="submit"]'); if (!btn) return;
    const b = this.blocked();
    if (b) { btn.disabled = true; btn.dataset.auBlocked = 'true'; btn.title = this.t[b]; }
    else if (btn.dataset.auBlocked) { delete btn.dataset.auBlocked; btn.removeAttribute('title'); btn.disabled = false; }
  }

  /* ---------- render ---------- */
  update() {
    const issues = this.allIssues();
    const needed = this.cfg.sides; const done = (this.state.front.file ? 1 : 0) + (needed === 2 && this.state.back.file ? 1 : 0);
    this.querySelectorAll('[data-au-count]').forEach((el) => { el.textContent = fmt(this.t.files_uploaded, { done, total: needed }); });
    const doc = this.doc;
    this.querySelector('[data-au-template-label]').textContent = this.trim ? fmt(this.t.template, { w: r2(this.trim.w), h: r2(this.trim.h), bw: r2(doc.w), bh: r2(doc.h), dpi: this.cfg.minDpi }) : this.t.no_template;
    ['front', 'back'].forEach((k) => {
      const tile = this.querySelector(`[data-au-tile="${k}"]`); const s = this.state[k];
      tile.classList.toggle('is-done', !!s.file);
      const label = tile.querySelector('[data-au-filename]'); tile.dataset.def ||= label.textContent;
      label.textContent = s.file ? `${s.file.name} · ${r2(s.file.size / 1048576)} MB` : tile.dataset.def;
      tile.querySelector('[data-au-remove]').hidden = !s.file;
    });
    const ul = this.querySelector('[data-au-warnings]'); ul.replaceChildren();
    const problems = issues.filter((i) => i.level === 'error' || i.level === 'warning');
    this.querySelector('[data-au-badge]').textContent = problems.length;
    if (!issues.length) { const li = document.createElement('li'); li.className = 'is-ok'; li.textContent = this.t.no_warnings; ul.append(li); }
    issues.forEach((i) => {
      const li = document.createElement('li'); li.className = `is-${i.level}`;
      li.textContent = `${this.t[i.side]}: ${i.text}`;
      if (i.fix) { const b = document.createElement('button'); b.type = 'button'; b.className = 'button button--secondary'; b.textContent = this.t.auto_rotate; b.dataset.side = i.fix; b.addEventListener('click', () => this.act('autorotate', b)); li.append(document.createElement('br'), b); }
      ul.append(li);
    });
    this.querySelector('[data-au-scale]').value = Math.round(this.side.scale * 100);
    this.drop.hidden = !!this.side.source;
    this.writeProps(issues);
    const b = this.blocked(); this.querySelector('[data-au-status]').textContent = b ? this.t[b] : '';
    this.applyGate(); this.draw();
  }
  writeProps(issues) {
    const has = this.state.front.file || this.state.back.file;
    const summary = issues.filter((i) => i.level !== 'ok').map((i) => `${this.t[i.side]}: ${i.text}`).join(' | ') || this.t.no_warnings;
    const fit = ['front', 'back'].filter((k) => this.state[k].file).map((k) => { const s = this.state[k]; return `${this.t[k]}: rot ${s.rot}°, scale ${Math.round(s.scale * 100)}%, offset ${r2(s.x)}in,${r2(s.y)}in${s.dpi ? `, ${s.dpi} dpi` : ''}`; }).join(' | ');
    const raw = { v: 1, trim: this.trim, bleed: this.cfg.bleed, safe: this.cfg.safe, minDpi: this.cfg.minDpi, sides: this.cfg.sides, confirmed: this.querySelector('[data-au-confirm]').checked,
      files: Object.fromEntries(['front', 'back'].filter((k) => this.state[k].file).map((k) => { const s = this.state[k]; return [k, { name: s.file.name, bytes: s.file.size, ext: s.ext, px: [s.pxW, s.pxH], pdf: s.pdf, color: s.color, dpi: s.dpi, rot: s.rot, scale: r2(s.scale), x: r2(s.x), y: r2(s.y) }]; })),
      issues: issues.map((i) => ({ side: i.side, level: i.level, key: i.key })) };
    const set = (k, v) => { const el = this.querySelector(`[data-au-prop="${k}"]`); el.value = v; el.disabled = !has; };
    set('summary', summary.slice(0, 1000)); set('fit', fit); set('raw', JSON.stringify(raw));
  }
  get cssRatio() { const r = this.canvas.getBoundingClientRect(); return r.width ? this.canvas.width / r.width : 1; }
  toCanvas(e) { const r = this.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * this.cssRatio, y: (e.clientY - r.top) * this.cssRatio }; }
  draw() {
    if (!this.dialog.open) return;
    const doc = this.doc || { w: 3.5, h: 2 }; const ctx = this.ctx; const dpr = window.devicePixelRatio || 1;
    const avail = Math.max(240, this.wrap.clientWidth - 40) * this.zoom; const maxH = Math.max(240, window.innerHeight * 0.5) * this.zoom;
    const pad = 24 * dpr; const ppi = Math.min((avail * dpr - 2 * pad) / doc.w, (maxH * dpr - 2 * pad) / doc.h); this.ppi = ppi;
    const W = Math.round(doc.w * ppi + 2 * pad); const H = Math.round(doc.h * ppi + 2 * pad);
    this.canvas.width = W; this.canvas.height = H; this.canvas.style.width = `${W / dpr}px`;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.fillRect(pad, pad, doc.w * ppi, doc.h * ppi);
    const s = this.side; const b = this.cfg.bleed * ppi; const sf = (this.cfg.bleed + this.cfg.safe) * ppi;
    if (s.source && this.doc) {
      const rotated = s.rot % 180 !== 0; const aw = rotated ? s.pxH : s.pxW; const ah = rotated ? s.pxW : s.pxH;
      const k = Math.max((doc.w * ppi) / aw, (doc.h * ppi) / ah) * s.scale;
      ctx.save(); ctx.translate(pad + (doc.w / 2 + s.x) * ppi, pad + (doc.h / 2 + s.y) * ppi); ctx.rotate((s.rot * Math.PI) / 180);
      ctx.drawImage(s.source, (-s.pxW * k) / 2, (-s.pxH * k) / 2, s.pxW * k, s.pxH * k); ctx.restore();
    }
    // mask outside the cut line
    ctx.save(); ctx.fillStyle = `rgba(255,255,255,${this.mask})`; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(pad + b, pad + b, doc.w * ppi - 2 * b, doc.h * ppi - 2 * b); ctx.fill('evenodd'); ctx.restore();
    const box = (inset, color, dash) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash(dash.map((d) => d * dpr)); ctx.strokeRect(pad + inset, pad + inset, doc.w * ppi - 2 * inset, doc.h * ppi - 2 * inset); ctx.restore(); };
    if (this.showGuides) { box(0, COLORS.bleed, [4, 3]); box(sf, COLORS.safe, [6, 4]); }
    if (this.showCut) box(b, COLORS.cut, []);
    if (this.magnify && this.mag) {
      const r = 70 * dpr; const z = 3; const { x, y } = this.mag;
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(this.canvas, x - r / z, y - r / z, (2 * r) / z, (2 * r) / z, x - r, y - r, 2 * r, 2 * r); ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#111'; ctx.stroke();
    }
  }
}
if (!customElements.get('artwork-uploader')) customElements.define('artwork-uploader', ArtworkUploader);
