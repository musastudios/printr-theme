/* PRINTR artwork uploader + client-side preflight (no framework).
 * Files travel to Shopify as native line item property file inputs (properties[Artwork Front|Back])
 * associated with the product form via the `form` attribute. */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const ALL_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'eps'];
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(parseFloat(v)) ? null : parseFloat(v));
const first = (...a) => a.find((v) => v !== null && v !== undefined);
const PREVIEWABLE = ['jpg', 'jpeg', 'png'];
const COLORS = { bleed: '#000000', cut: '#e0102b', safe: '#1e6bff' };
let pdfjsPromise;
const loadPdfjs = () => (pdfjsPromise ||= import(PDFJS).then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; }));
const fmt = (s, vars = {}) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
const r2 = (n) => Math.round(n * 100) / 100;
/** Convert flat product FormData into items[0][..] once (shared shape with design-service.js); return next free index. */
function toItems(fd) {
  if (!fd.has('items[0][id]')) {
    const entries = [...fd.entries()];
    entries.forEach(([k]) => fd.delete(k));
    entries.forEach(([k, v]) => {
      if (k === 'id' || k === 'quantity' || k === 'selling_plan') fd.append(`items[0][${k}]`, v);
      else if (k.startsWith('properties[')) fd.append(`items[0]${k}`, v);
      else fd.append(k, v);
    });
    if (!fd.has('items[0][quantity]')) fd.append('items[0][quantity]', '1');
  }
  let n = 0; while (fd.has(`items[${n}][id]`)) n++;
  return n;
}
const BRIEF_PROP = 'Brief after checkout (Design Service)';

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

/** Normalise spec.special (string, comma list, JSON list) into a Set of mode keys. */
export function parseSpecial(v) {
  let list = v;
  if (typeof v === 'string') { try { list = JSON.parse(v); } catch (e) { list = v.split(/[,;|]/); } }
  if (!Array.isArray(list)) list = list ? [list] : [];
  const out = new Set(); let folds = 0;
  list.map((x) => String(x).trim().toLowerCase()).filter(Boolean).forEach((x) => {
    const m = x.match(/^(?:folds?|fold)[:=\s]*(\d+)/); if (m) { out.add('folds'); folds = parseInt(m[1], 10); return; }
    if (/tri-?fold|z-?fold|letter-?fold/.test(x)) { out.add('folds'); folds = 3; return; }
    if (/bi-?fold|half-?fold|folded/.test(x)) { out.add('folds'); folds ||= 2; return; }
    if (/grommet/.test(x)) { out.add('grommets'); out.add('large_format'); return; }
    if (/large|banner|poster|wide/.test(x)) out.add('large_format');
    else if (/die|cut[_ -]?path|contour|sticker/.test(x)) out.add('die_cut');
    else if (/apparel|print[_ -]?area|shirt|garment/.test(x)) out.add('apparel_area');
    else out.add(x.replace(/\s+/g, '_'));
  });
  out.panelCount = folds; return out;
}

/** Panels: list/JSON of panel widths (inches) or a count; returns fold x-positions in inches from the trim's left edge. */
export function foldPositions(panels, count, trimW) {
  let list = panels;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = list.split(/[,;|x]/).map(parseFloat).filter((n) => n > 0); } }
  if (typeof list === 'number') { count = list; list = null; }
  if (Array.isArray(list) && list.length > 1) { const out = []; let acc = 0; list.slice(0, -1).forEach((w) => { acc += parseFloat(w); out.push(acc); }); return out; }
  const n = count || 2; return Array.from({ length: n - 1 }, (_, i) => (trimW * (i + 1)) / n);
}

/** Sides implied by a variant option: "4/0" or "Single-Sided" => 1, "4/4", "5/1" or "Double-Sided" => 2; null when no hint. */
export function sidesFromOptions(options) {
  for (const o of options || []) {
    const s = String(o).toLowerCase();
    const m = s.match(/(?:^|\s)(\d)\/(\d)\s*colou?r/); if (m) return parseInt(m[2], 10) > 0 ? 2 : 1;
    if (/single[- ]sided|one[- ]sided|1[- ]sided/.test(s)) return 1;
    if (/double[- ]sided|two[- ]sided|2[- ]sided/.test(s)) return 2;
  }
  return null;
}

/** Profile size whose trim matches a size string in either orientation. */
export function matchSize(sizes, options) {
  if (!Array.isArray(sizes)) return null;
  for (const o of options || []) {
    const d = parseSize(o); if (!d) continue;
    const hit = sizes.find((z) => z && ((Math.abs(z.trim_w_in - d.w) < 0.01 && Math.abs(z.trim_h_in - d.h) < 0.01) || (Math.abs(z.trim_w_in - d.h) < 0.01 && Math.abs(z.trim_h_in - d.w) < 0.01)));
    if (hit) return hit;
  }
  return null;
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

/* Lucide icons (lucide-static v1.61.0, ISC licence — see docs/LICENSES-lucide.md). */
const ICONS = {"rectangle-horizontal": "<rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\" />", "rotate-cw": "<path d=\"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8\" /><path d=\"M21 3v5h-5\" />", "scan": "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\" /><path d=\"M17 3h2a2 2 0 0 1 2 2v2\" /><path d=\"M21 17v2a2 2 0 0 1-2 2h-2\" /><path d=\"M7 21H5a2 2 0 0 1-2-2v-2\" />", "undo-2": "<path d=\"M9 14 4 9l5-5\" /><path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\" />", "zoom-in": "<circle cx=\"11\" cy=\"11\" r=\"8\" /><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\" /><line x1=\"11\" x2=\"11\" y1=\"8\" y2=\"14\" /><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\" />", "zoom-out": "<circle cx=\"11\" cy=\"11\" r=\"8\" /><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\" /><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\" />", "ruler": "<path d=\"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z\" /><path d=\"m14.5 12.5 2-2\" /><path d=\"m11.5 9.5 2-2\" /><path d=\"m8.5 6.5 2-2\" /><path d=\"m17.5 15.5 2-2\" />", "scissors": "<circle cx=\"6\" cy=\"6\" r=\"3\" /><path d=\"M8.12 8.12 12 12\" /><path d=\"M20 4 8.12 15.88\" /><circle cx=\"6\" cy=\"18\" r=\"3\" /><path d=\"M14.8 14.8 20 20\" />", "search": "<path d=\"m21 21-4.34-4.34\" /><circle cx=\"11\" cy=\"11\" r=\"8\" />", "blend": "<circle cx=\"15\" cy=\"9\" r=\"7\" /><circle cx=\"9\" cy=\"15\" r=\"7\" />", "rotate-ccw": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /><path d=\"M3 3v5h5\" />", "sliders-horizontal": "<path d=\"M10 5H3\" /><path d=\"M12 19H3\" /><path d=\"M14 3v4\" /><path d=\"M16 17v4\" /><path d=\"M21 12h-9\" /><path d=\"M21 19h-5\" /><path d=\"M21 5h-7\" /><path d=\"M8 10v4\" /><path d=\"M8 12H3\" />", "chevron-down": "<path d=\"m6 9 6 6 6-6\" />", "flip-horizontal-2": "<path d=\"M10 12H8\" /><path d=\"M16 12h-2\" /><path d=\"M22 12h-2\" /><path d=\"M4 12H2\" /><path d=\"M7.298 20.288A1 1 0 008 22h8a1 1 0 00.703-1.712l-3.991-3.99a1 1 0 00-1.424-.001z\" /><path d=\"M7.298 3.712A1 1 0 018 2h8a1 1 0 01.703 1.712l-3.991 3.99a1 1 0 01-1.424.001z\" />", "box": "<path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\" /><path d=\"m3.3 7 8.7 5 8.7-5\" /><path d=\"M12 22V12\" />", "upload": "<path d=\"M12 3v12\" /><path d=\"m17 8-5-5-5 5\" /><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />", "replace": "<path d=\"M14 4a1 1 0 0 1 1-1\" /><path d=\"M15 10a1 1 0 0 1-1-1\" /><path d=\"M21 4a1 1 0 0 0-1-1\" /><path d=\"M21 9a1 1 0 0 1-1 1\" /><path d=\"m3 7 3 3 3-3\" /><path d=\"M6 10V5a2 2 0 0 1 2-2h2\" /><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\" />", "trash-2": "<path d=\"M10 11v6\" /><path d=\"M14 11v6\" /><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\" /><path d=\"M3 6h18\" /><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\" />", "file-image": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /><path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /><circle cx=\"10\" cy=\"12\" r=\"2\" /><path d=\"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22\" />", "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m16 9-5.5 5.5L8 12\" />", "triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /><path d=\"M12 9v4\" /><path d=\"M12 17h.01\" />", "circle-x": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m15 9-6 6\" /><path d=\"m9 9 6 6\" />", "circle-dashed": "<path d=\"M10.1 2.182a10 10 0 0 1 3.8 0\" /><path d=\"M13.9 21.818a10 10 0 0 1-3.8 0\" /><path d=\"M17.609 3.721a10 10 0 0 1 2.69 2.7\" /><path d=\"M2.182 13.9a10 10 0 0 1 0-3.8\" /><path d=\"M20.279 17.609a10 10 0 0 1-2.7 2.69\" /><path d=\"M21.818 10.1a10 10 0 0 1 0 3.8\" /><path d=\"M3.721 6.391a10 10 0 0 1 2.7-2.69\" /><path d=\"M6.391 20.279a10 10 0 0 1-2.69-2.7\" />", "loader-circle": "<path d=\"M21 12a9 9 0 1 1-6.219-8.56\" />", "download": "<path d=\"M12 15V3\" /><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /><path d=\"m7 10 5 5 5-5\" />", "clock": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 6v6l4 2\" />", "check": "<path d=\"M20 6 9 17l-5-5\" />", "x": "<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />", "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />", "move": "<path d=\"M12 2v20\" /><path d=\"m15 19-3 3-3-3\" /><path d=\"m19 9 3 3-3 3\" /><path d=\"M2 12h20\" /><path d=\"m5 9-3 3 3 3\" /><path d=\"m9 5 3-3 3 3\" />", "info": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 16v-4\" /><path d=\"M12 8h.01\" />"};
const icon = (n, size = 20, cls = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${cls ? ` class="${cls}"` : ''}>${ICONS[n] || ''}</svg>`;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));
const SIDES = ['front', 'back'];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
/* Shopify's `t` filter HTML-escapes non-_html keys, so `| t | json` ships &quot; / &#39; literally. Decode once here. */
export function decodeEntities(v) {
  if (typeof v !== 'string' || !v.includes('&')) return v;
  const ta = document.createElement('textarea'); ta.innerHTML = v; return ta.value;
}
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FOLD_OPT = /(?:tri|z|half|bi|letter)[- ]?fold|folded/i;
// Merged option codes such as "GB100-44-AQ-TRI" (stock-colors-coating-fold) expand to readable hints for fold and sides.
const CODE_FOLD = { TRI: 'Tri-Fold', HALF: 'Half-Fold', Z: 'Z-Fold' };
export function expandOptions(options) {
  const out = [];
  (options || []).forEach((o) => {
    out.push(o);
    const m = String(o).match(/^[A-Z0-9]+-(\d)(\d)-[A-Z]+(?:-([A-Z]+))?$/);
    if (m) { out.push(`${m[1]}/${m[2]} color`); if (CODE_FOLD[m[3]]) out.push(CODE_FOLD[m[3]]); }
  });
  return out;
}
const LEVEL_RANK = { ok: 0, review: 1, wait: 1, run: 1, warn: 2, err: 3 };

class ArtworkUploader extends HTMLElement {
  connectedCallback() {
    const $ = (s) => this.querySelector(s);
    this.t = Object.fromEntries(Object.entries(JSON.parse($('[data-au-strings]').textContent)).map(([k, v]) => [k, decodeEntities(v)]));
    this.variants = JSON.parse($('[data-au-variants]').textContent);
    const pj = $('[data-au-profile]'); try { this.profile = pj ? JSON.parse(pj.textContent) : {}; } catch (e) { this.profile = {}; }
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
    this.base = { ...this.cfg };
    this.dialog = $('dialog'); this.canvas = $('[data-au-canvas]'); this.ctx = this.canvas.getContext('2d');
    this.wrap = $('[data-au-wrap]'); this.drop = $('[data-au-drop]');
    this.state = { front: this.blankSide(), back: this.blankSide() };
    this.active = 'front'; this.zoom = 1; this.mask = 0.6; this.showGuides = true; this.showCut = true; this.magnify = false; this.landscape = null; this.view3d = false;
    this.mode = 'upload';
    this.bind();
    this.setVariant(this.dataset.variant);
    document.addEventListener('variant:change', (e) => { this.setVariant(e.detail.variantId, e.detail.options); this.applyGate(); });
    // Capture-phase guard so the theme's ProductForm (and native submit) never fire while blocked.
    document.addEventListener('submit', (e) => this.guard(e), true);
    // Capture-phase click guard for every buy control tied to this form (submit, theme Buy it now, native payment button, sticky bar).
    document.addEventListener('click', (e) => this.onBuyClick(e), true);
    document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[aria-disabled="true"][data-au-blocked]')) { e.preventDefault(); this.onBuyClick(e); } }, true);
    // The buy block is re-rendered on variant change; re-apply the gate to the new buttons.
    const buyBlock = document.getElementById(`BuyBlock-${this.dataset.section}`);
    if (buyBlock) new MutationObserver(() => this.applyGate()).observe(buyBlock, { childList: true, subtree: true });
    this.update();
  }
  blankSide() { return { file: null, ext: '', source: null, pxW: 0, pxH: 0, pdf: null, rot: 0, scale: 1, x: 0, y: 0, history: [], issues: [], phase: 'empty', progress: 0 }; }
  get form() { return document.getElementById(this.dataset.formId); }

  /* ---------- template geometry ---------- */
  /**
   * Precedence: variant print_spec override > profile size matching the variant's size option >
   * product print_spec > product metafields/block settings > Size option parse.
   */
  pickSpec(v) {
    const p = this.profile || {};
    if (v && v.spec) return v.spec;
    const opts = this.cfg.sizeIndex >= 0 && v ? [v.options[this.cfg.sizeIndex], ...v.options] : v?.options;
    return matchSize(p.sizes, opts) || p.product_spec || null;
  }
  resolveSpec(v) {
    const p = this.profile || {};
    const sp = { ...(this.pickSpec(v) || {}) };
    if (!sp.special && p.mode) sp.special = p.mode;
    // A fold chosen in a variant option (e.g. Finish "… · Tri-Fold (Letter)") turns a flat profile into a folded piece.
    const vOpts = expandOptions(v?.options);
    const foldOpt = vOpts.find((o) => FOLD_OPT.test(String(o)));
    this.foldFromOption = !!foldOpt && !parseSpecial(sp.special).has('folds');
    if (this.foldFromOption) sp.special = [...parseSpecial(sp.special)].concat(String(foldOpt).match(FOLD_OPT)[0]);
    if (!sp.formats && p.formats) sp.formats = p.formats;
    if (!parseSpecial(sp.special).has('apparel_area')) { const os = sidesFromOptions(vOpts); if (os) sp.sides = os; }
    this.spec = sp;
    const b = this.base; const special = parseSpecial(sp.special);
    const large = special.has('large_format'); const apparel = special.has('apparel_area');
    const specMin = num(sp.min_dpi); const specWarn = num(sp.warn_dpi);
    let formats = sp.formats; if (typeof formats === 'string') { try { formats = JSON.parse(formats); } catch (e) { formats = formats.split(/[,;|\s]+/); } }
    formats = Array.isArray(formats) ? formats.map((f) => String(f).toLowerCase().replace(/^\./, '')).filter((f) => ALL_EXT.includes(f)) : [];
    if (formats.includes('jpg') && !formats.includes('jpeg')) formats.push('jpeg');
    if (formats.includes('tif') && !formats.includes('tiff')) formats.push('tiff');
    this.cfg = {
      ...b,
      trimW: first(num(sp.trim_w_in), b.trimW || null) || 0,
      trimH: first(num(sp.trim_h_in), b.trimH || null) || 0,
      bleed: apparel ? 0 : first(num(sp.bleed_in), b.bleed),
      safe: apparel ? 0 : first(num(sp.safe_in), b.safe),
      // error below errDpi, warn below warnDpi
      errDpi: first(specMin, large ? 75 : 150),
      warnDpi: first(specWarn, specMin !== null ? Math.max(specMin, large ? 150 : 300) : (large ? 150 : b.minDpi)),
      sides: Math.min(2, Math.max(1, parseInt(first(num(sp.sides), b.sides), 10) || 1)),
      pages: num(sp.pages),
      formats: formats.length ? formats : ALL_EXT,
      special, panels: sp.panels
    };
    this.cfg.minDpi = this.cfg.warnDpi;
    this.querySelector('[data-au-tile="back"]').hidden = this.cfg.sides < 2;
    this.querySelector('[data-au-tab="back"]').hidden = this.cfg.sides < 2;
    this.querySelector('[data-au-sel="back"]').hidden = this.cfg.sides < 2;
    if (this.cfg.sides < 2 && this.active === 'back') this.active = 'front';
    const accept = this.cfg.formats.map((f) => `.${f}`).join(',');
    this.querySelectorAll('[data-au-input]').forEach((i) => { i.accept = accept; });
    const fmts = this.cfg.formats.filter((f) => f !== 'jpeg' && f !== 'tiff').join(', ').toUpperCase();
    this.querySelectorAll('[data-au-formats]').forEach((e) => { e.textContent = fmt(this.t.drop_formats, { formats: fmts, max: r2(this.cfg.maxBytes / 1048576) }); });
    const guide = [decodeEntities(p.guidance), decodeEntities(sp.notes), this.foldFromOption ? fmt(this.t.folds, { n: special.panelCount || 2 }) : ''].filter(Boolean).join('\n');
    this.querySelectorAll('[data-au-guidance]').forEach((e) => { e.textContent = guide; e.hidden = !guide; });
    this.querySelectorAll('[data-au-template-link]').forEach((tl) => { tl.href = p.template_url || '#'; tl.hidden = !p.template_url; });
  }
  setVariant(id, options) {
    // product.variants caps at 250 in Liquid; callers may pass the variant's options for ids outside that list.
    const v = this.variants.find((x) => String(x.id) === String(id)) || (Array.isArray(options) && options.length ? { id, options } : this.variants[0]);
    this.resolveSpec(v);
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
    q('[data-au-open]').forEach((b) => b.addEventListener('click', () => this.openStudio()));
    this.querySelector('[data-au-open-replace]')?.addEventListener('click', () => this.openStudio());
    q('[data-au-close]').forEach((b) => b.addEventListener('click', () => this.requestClose()));
    this.dialog.addEventListener('cancel', (e) => { if (this.busy && !window.confirm(this.t.busy_close)) e.preventDefault(); else this.abortAll(); });
    this.dialog.addEventListener('close', () => { this.closeMenu(false); this.querySelector('[data-au-open]').focus(); });
    q('[data-au-input]').forEach((inp) => inp.addEventListener('change', () => this.onFile(inp.dataset.auInput, inp.files[0])));
    q('[data-au-remove]').forEach((b) => b.addEventListener('click', () => this.removeFile(b.dataset.auRemove)));
    q('[data-au-replace]').forEach((b) => b.addEventListener('click', () => this.input(b.dataset.auReplace)?.click()));
    this.querySelector('[data-au-browse]').addEventListener('click', () => this.input(this.active)?.click());
    this.querySelector('[data-au-cancel]').addEventListener('click', () => this.cancelUpload(this.active));
    this.querySelector('[data-au-confirm]').addEventListener('change', () => this.update());
    this.querySelector('[data-au-later-toggle]')?.addEventListener('change', (e) => { this.mode = e.target.checked ? 'later' : 'upload'; this.update(); });
    q('[data-au-send-later]').forEach((b) => b.addEventListener('click', () => this.sendLater()));
    this.querySelector('[data-au-approve]').addEventListener('click', () => this.approve());
    this.querySelector('[data-au-policy]').addEventListener('change', () => this.update());
    // The big CTA is also a drop target: dropping a file opens the studio with it loaded.
    const cta = this.querySelector('[data-au-open]');
    ['dragenter', 'dragover'].forEach((t) => cta.addEventListener(t, (e) => { e.preventDefault(); cta.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => cta.addEventListener(t, () => cta.classList.remove('is-over')));
    cta.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; this.openStudio(); this.setInputFile('front', f); });
    this.querySelector('[data-au-qa]')?.addEventListener('change', () => this.update());
    // Rewrite the product form payload into an items[] array so the QA fee joins the same /cart/add call.
    // formdata does not bubble; capture at document so the hook survives the buy form being re-rendered on variant change.
    document.addEventListener('formdata', (e) => { if (e.target.id === this.dataset.formId) this.onFormData(e.formData); }, true);
    // Design Service selector: a paid tier means the customer sends a brief after checkout (no upload gate) and QA is included.
    document.addEventListener('design:change', (e) => { if (e.detail.formId === this.dataset.formId) { this.design = e.detail; this.update(); } });
    // tabs: click + roving arrow keys
    // Two tablists drive the same panel: side cards (desktop, vertical) and the compact segmented control (mobile).
    [['[data-au-tab]', 'auTab'], ['[data-au-sel]', 'auSel']].forEach(([sel, key]) => {
      const tabs = () => [...q(sel)].filter((b) => !b.hidden && !b.closest('[hidden]'));
      q(sel).forEach((b) => {
        b.addEventListener('click', () => this.tab(b.dataset[key]));
        b.addEventListener('keydown', (e) => {
          const l = tabs(); let i = l.indexOf(b);
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (i + 1) % l.length; else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (i - 1 + l.length) % l.length; else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = l.length - 1; else return;
          e.preventDefault(); l[i].focus(); this.tab(l[i].dataset[key]);
        });
      });
    });
    // clicking empty card space also selects that side
    q('[data-au-tile]').forEach((t) => t.addEventListener('click', (e) => { if (!e.target.closest('button,label,input,a')) this.tab(t.dataset.auTile); }));
    // toolbar: roving tabindex across its direct controls
    const tb = this.querySelector('[role=toolbar]');
    const tbItems = () => [...tb.querySelectorAll('button')].filter((b) => !b.closest('[role=menu]') && b.offsetParent !== null);
    tb.addEventListener('keydown', (e) => {
      if (e.target.closest('[role=menu]')) return;
      const l = tbItems(); let i = l.indexOf(e.target); if (i < 0) return;
      if (e.key === 'ArrowRight') i = (i + 1) % l.length; else if (e.key === 'ArrowLeft') i = (i - 1 + l.length) % l.length; else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = l.length - 1; else return;
      e.preventDefault(); l.forEach((b) => { b.tabIndex = -1; }); l[i].tabIndex = 0; l[i].focus();
    });
    tb.addEventListener('focusin', (e) => { if (e.target.closest('[role=menu]')) return; const l = tbItems(); if (l.includes(e.target)) { l.forEach((b) => { b.tabIndex = -1; }); e.target.tabIndex = 0; } });
    q('[data-au-act]').forEach((b) => b.addEventListener('click', () => this.act(b.dataset.auAct, b)));
    // view options menu
    this.menuBtn = this.querySelector('[data-au-menu-btn]'); this.menu = this.querySelector('[data-au-menu]');
    this.menuBtn.addEventListener('click', () => (this.menu.hidden ? this.openMenu() : this.closeMenu(true)));
    this.menuBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); this.openMenu(); } });
    this.menu.addEventListener('keydown', (e) => {
      const items = [...this.menu.querySelectorAll('[role^=menuitem], input')].filter((x) => x.offsetParent !== null);
      let i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeMenu(true); return; }
      if (e.key === 'Tab') { this.closeMenu(false); return; }
      if (document.activeElement.type === 'range' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
      if (e.key === 'ArrowDown') i = (i + 1) % items.length; else if (e.key === 'ArrowUp') i = (i - 1 + items.length) % items.length; else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = items.length - 1; else return;
      e.preventDefault(); items[i].focus();
    });
    document.addEventListener('pointerdown', (e) => { if (!this.menu.hidden && !e.target.closest('.au__vo')) this.closeMenu(false); });
    // tooltips: Esc dismisses without moving focus (WCAG 1.4.13)
    this.dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') q('.au-tip').forEach((t) => t.classList.add('au-tip--off')); }, true);
    this.dialog.addEventListener('focusout', () => q('.au-tip--off').forEach((t) => t.classList.remove('au-tip--off')));
    this.dialog.addEventListener('pointerover', () => q('.au-tip--off').forEach((t) => t.classList.remove('au-tip--off')));
    const scale = this.querySelector('[data-au-scale]');
    scale.addEventListener('pointerdown', () => this.push()); scale.addEventListener('keydown', () => this.push());
    scale.addEventListener('input', () => { this.side.scale = scale.value / 100; this.analyze(this.active, false); this.update(); });
    this.querySelector('[data-au-mask]').addEventListener('input', (e) => { this.mask = e.target.value / 100; this.draw(); });
    // drag & drop on the canvas and on each tile
    ['dragenter', 'dragover'].forEach((t) => this.wrap.addEventListener(t, (e) => { e.preventDefault(); this.drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => this.wrap.addEventListener(t, () => this.drop.classList.remove('is-over')));
    this.wrap.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) this.setInputFile(this.active, f); });
    q('[data-au-dz]').forEach((dz) => {
      ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('is-over')));
      dz.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) this.setInputFile(dz.dataset.auDz, f); });
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
    // keyboard positioning: arrows nudge, R rotate, +/- scale, Ctrl+Z undo
    this.canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01; const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (m && this.side.source) { e.preventDefault(); this.push(); this.side.x += m[0]; this.side.y += m[1]; this.update(); }
      else if (e.key === '+' || e.key === '=') this.setScale(this.side.scale * 1.05);
      else if (e.key === '-' || e.key === '−') this.setScale(this.side.scale / 1.05);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.act('undo'); }
      else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'r' && this.side.source) { e.preventDefault(); this.act('rotate'); }
    });
    window.addEventListener('resize', () => this.dialog.open && this.draw());
    if (window.ResizeObserver) { let raf = 0; new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => this.dialog.open && this.draw()); }).observe(this.wrap); }
  }
  get qa() { return !this.qaHidden && !!this.querySelector('[data-au-qa]')?.checked && !!this.dataset.feeVariant; }
  get brief() { return !!(this.design && this.design.paid); }
  get qaHidden() { return this.brief && this.design.hideQa; }
  onFormData(fd) {
    if (!this.qa) return;
    const link = `au${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const n = toItems(fd);
    fd.append('items[0][properties][_artwork_link]', link);
    fd.append('items[0][properties][Pre-flight QA]', 'Yes');
    fd.append(`items[${n}][id]`, this.dataset.feeVariant);
    fd.append(`items[${n}][quantity]`, '1');
    fd.append(`items[${n}][properties][_for]`, this.dataset.productTitle || '');
    fd.append(`items[${n}][properties][_artwork_link]`, link);
    fd.append(`items[${n}][properties][_artwork_fee]`, '1');
  }
  openStudio() { if (!this.dialog.open) this.dialog.showModal(); requestAnimationFrame(() => this.update()); }
  get busy() { return SIDES.some((k) => ['uploading', 'analyzing'].includes(this.state[k].phase)); }
  requestClose() { if (this.busy && !window.confirm(this.t.busy_close)) return; this.abortAll(); this.dialog.close(); }
  abortAll() { SIDES.forEach((k) => { if (this.state[k].phase === 'uploading') this.cancelUpload(k, true); }); }
  openMenu() { this.menu.hidden = false; this.menuBtn.setAttribute('aria-expanded', 'true'); this.menu.querySelector('[role^=menuitem]')?.focus(); }
  closeMenu(focus) { if (!this.menu || this.menu.hidden) return; this.menu.hidden = true; this.menuBtn.setAttribute('aria-expanded', 'false'); if (focus) this.menuBtn.focus(); }
  input(side) { return this.querySelector(`[data-au-input="${side}"]`); }
  setInputFile(side, f) { const inp = this.input(side); const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; this.onFile(side, f); }
  get side() { return this.state[this.active]; }
  tab(name) {
    this.active = name;
    this.querySelectorAll('[data-au-tab],[data-au-sel]').forEach((b) => { const on = (b.dataset.auTab || b.dataset.auSel) === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    const mobile = window.matchMedia?.('(max-width: 639px)').matches;
    this.wrap.setAttribute('aria-labelledby', this.querySelector(mobile ? `[data-au-tab="${name}"]` : `[data-au-sel="${name}"]`).id);
    this.update();
  }
  push() { const s = this.side; s.history.push({ rot: s.rot, scale: s.scale, x: s.x, y: s.y }); if (s.history.length > 50) s.history.shift(); }
  setScale(v) { this.push(); this.side.scale = Math.min(4, Math.max(0.1, v)); this.analyze(this.active, false); this.update(); }
  setZoom(z) { this.zoom = Math.min(3, Math.max(0.5, Math.round(z * 4) / 4)); this.querySelector('[data-au-zoom-out]').value = `${Math.round(this.zoom * 100)}%`; this.draw(); }
  act(a, btn) {
    const s = this.side;
    const check = (on) => this.querySelectorAll(`[data-au-act="${a}"]`).forEach((b) => b.setAttribute(b.getAttribute('role') === 'menuitemcheckbox' ? 'aria-checked' : 'aria-pressed', String(on)));
    switch (a) {
      case 'orientation': this.landscape = !this.landscape; if (this.trim) this.trim = { w: this.trim.h, h: this.trim.w }; SIDES.forEach((k) => this.state[k].source && this.analyze(k, false)); break;
      case 'rotate': this.push(); s.rot = (s.rot + 90) % 360; this.fit(s); this.analyze(this.active, false); break;
      case 'fit': this.push(); this.fit(s); this.analyze(this.active, false); break;
      case 'undo': { const h = s.history.pop(); if (h) Object.assign(s, h); this.analyze(this.active, false); break; }
      case 'reset': this.push(); s.rot = 0; this.fit(s); this.analyze(this.active, false); break;
      case 'zoom-in': this.setZoom(this.zoom + 0.25); return;
      case 'zoom-out': this.setZoom(this.zoom - 0.25); return;
      case 'magnify': this.magnify = !this.magnify; check(this.magnify); break;
      case 'guides': this.showGuides = !this.showGuides; check(this.showGuides); break;
      case 'cut': this.showCut = !this.showCut; check(this.showCut); break;
      case '3d': this.view3d = !this.view3d; check(this.view3d); this.wrap.classList.toggle('is-3d', this.view3d); break;
      case 'autorotate': { const k = btn.dataset.side; const t = this.state[k]; this.active = k; this.push(); t.rot = (t.rot + 90) % 360; this.fit(t); this.analyze(k, false); break; }
      case 'replace': this.input(btn?.dataset.side || this.active)?.click(); return;
    }
    this.update();
  }
  /** Scale 1 == art covers trim+bleed exactly (cover fit), centred. */
  fit(s) { s.scale = 1; s.x = 0; s.y = 0; }
  announce(msg) { const a = this.querySelector('[data-au-alert]'); a.textContent = ''; requestAnimationFrame(() => { a.textContent = msg; }); }
  approve() {
    const b = this.artBlocked();
    if (b) {
      this.announce(this.t[b]);
      if (b === 'confirm_needed') this.querySelector('[data-au-confirm]').focus();
      else if (b === 'art_required') this.input(this.active)?.focus();
      else this.querySelector('[data-au-checklist] [data-au-fix], [data-au-checklist] li')?.focus?.();
      return;
    }
    this.dialog.close(); this.update();
  }
  sendLater() {
    const t = this.querySelector('[data-au-later-toggle]'); if (!t) return;
    t.checked = true; this.mode = 'later'; this.update(); this.dialog.close();
  }

  /* ---------- file intake ---------- */
  removeFile(side) {
    const inp = this.input(side); inp.value = ''; this.state[side] = this.blankSide(); this.update();
    (this.querySelector(`[data-au-tile="${side}"] .au-dz input`) || inp).focus();
  }
  cancelUpload(side, silent) {
    const s = this.state[side]; s.reader?.abort(); s.cancelled = true;
    this.input(side).value = ''; this.state[side] = this.blankSide();
    if (!silent) { this.update(); this.querySelector('[data-au-browse]').focus(); }
  }
  /** Read the file locally with progress (the actual transfer happens with the cart form). */
  readWithProgress(s, file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader(); s.reader = r;
      r.onprogress = (e) => { if (e.lengthComputable) { s.progress = Math.round((e.loaded / e.total) * 100); this.renderProgress(); } };
      r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.onabort = () => reject(new Error('abort'));
      r.readAsArrayBuffer(file);
    });
  }
  async onFile(side, file) {
    const s = this.blankSide(); this.state[side] = s; s.file = file || null;
    if (!file) return this.update();
    if (this.active !== side) this.tab(side);
    s.ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!this.cfg.formats.includes(s.ext)) { s.phase = 'done'; s.issues = [this.issue('error', 'bad_format', { name: file.name, formats: this.cfg.formats.filter((f) => f !== 'jpeg' && f !== 'tiff').join(', ').toUpperCase() })]; return this.update(); }
    if (file.size > this.cfg.maxBytes) { s.phase = 'done'; s.issues = [this.issue('error', 'too_large', { name: file.name, size: r2(file.size / 1048576), max: r2(this.cfg.maxBytes / 1048576) })]; return this.update(); }
    s.phase = 'uploading'; this.update();
    let buf;
    try { buf = await this.readWithProgress(s, file); await wait(250); } catch (err) {
      if (s.cancelled || this.state[side] !== s) return;
      s.phase = 'done'; s.issues = [this.issue('error', 'err_upload')]; return this.update();
    }
    if (this.state[side] !== s) return;
    s.phase = 'analyzing'; this.update();
    try {
      if (PREVIEWABLE.includes(s.ext)) {
        s.source = await createImageBitmap(file); s.pxW = s.source.width; s.pxH = s.source.height;
        s.color = s.ext === 'png' ? 'rgb' : jpegColorSpace(buf.slice(0, 256 * 1024));
      } else if (s.ext === 'pdf') {
        await this.loadPdf(s, file);
      }
    } catch (err) { console.warn('[artwork-uploader]', err); s.loadError = true; }
    await wait(700);
    if (this.state[side] !== s) return;
    s.phase = 'done'; this.analyze(side, true); this.update();
    const n = this.counts(); this.announce(this.summaryText(n));
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
    const sp = this.cfg.special;
    if (sp.has('die_cut')) out.push(this.issue('warning', 'die_cut'));
    if (sp.has('folds')) out.push(this.issue('info', 'folds', { n: foldPositions(this.cfg.panels, sp.panelCount, this.trim?.w || 0).length + 1 }));
    if (sp.has('apparel_area')) out.push(this.issue('info', 'apparel'));
    if (sp.has('large_format')) out.push(this.issue('info', 'large_format', { dpi: this.cfg.warnDpi }));
    const rotated = s.rot % 180 !== 0;
    const artW = rotated ? s.pxH : s.pxW; const artH = rotated ? s.pxW : s.pxH;
    if (doc && s.pdf) {
      const pw = rotated ? s.pdf.hIn : s.pdf.wIn; const ph = rotated ? s.pdf.wIn : s.pdf.hIn; const tol = 0.03;
      const vars = { w: r2(pw), h: r2(ph), tw: r2(doc.w), th: r2(doc.h) };
      if (Math.abs(pw - doc.w) <= tol && Math.abs(ph - doc.h) <= tol) out.push(this.issue('ok', 'pdf_ok', vars));
      else if (Math.abs(pw - this.trim.w) <= tol && Math.abs(ph - this.trim.h) <= tol) out.push(this.issue('warning', 'pdf_no_bleed', { ...vars, bleed: this.cfg.bleed }));
      else if (Math.abs(ph - doc.w) <= tol && Math.abs(pw - doc.h) <= tol) out.push(this.issue('warning', 'orientation', { name }, { fix: side }));
      else out.push(this.issue('warning', 'pdf_size', vars));
      if (this.cfg.pages) { if (s.pdf.pages !== this.cfg.pages && !(this.cfg.sides === 2 && s.pdf.pages === 1)) out.push(this.issue('warning', 'pages_mismatch', { pages: s.pdf.pages, expected: this.cfg.pages })); }
      else if (s.pdf.pages !== this.cfg.sides && !(side === 'front' && s.pdf.pages === 1)) out.push(this.issue('warning', 'pdf_pages', { pages: s.pdf.pages, sides: this.cfg.sides }));
    } else if (doc && s.pxW && !s.pdf) {
      const artLand = artW > artH; const docLand = doc.w > doc.h;
      if (artW !== artH && doc.w !== doc.h && artLand !== docLand) out.push(this.issue('warning', 'orientation', { name }, { fix: side }));
      const ra = artW / artH; const rd = doc.w / doc.h;
      if (artLand === docLand && Math.abs(ra / rd - 1) > 0.02) out.push(this.issue(sp.has('apparel_area') ? 'info' : 'warning', 'aspect', { ar: r2(ra), tr: r2(rd) }));
      const dpi = Math.floor(this.effectiveDpi(s));
      if (dpi < this.cfg.errDpi) out.push(this.issue('error', 'dpi_too_low', { dpi, min: this.cfg.warnDpi, err: this.cfg.errDpi }));
      else if (dpi < this.cfg.warnDpi) out.push(this.issue('warning', 'dpi_low', { dpi, min: this.cfg.warnDpi }));
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
    const cover = this.cfg.special.has('apparel_area') ? Math.min(doc.w / w, doc.h / h) : Math.max(doc.w / w, doc.h / h); // inches per pixel at scale 1
    return 1 / (cover * s.scale);
  }
  allIssues() {
    const list = [];
    if (this.mode === 'later' || this.brief) return list;
    const needed = this.cfg.sides === 2 ? ['front', 'back'] : ['front'];
    needed.forEach((k) => {
      const s = this.state[k];
      if (!s.file) list.push({ side: k, ...this.issue('error', 'missing_file', { side: this.t[k] }) });
      else s.issues.forEach((i) => list.push({ side: k, ...i }));
    });
    return list;
  }
  /** Art gate (file passed preflight, send-later ticked, or paid Design Service) then the terms checkbox. */
  artBlocked() {
    if (this.brief || this.mode === 'later') return false;
    const needed = this.cfg.sides === 2 ? ['front', 'back'] : ['front'];
    if (!needed.some((k) => this.state[k].file)) return 'art_required';
    const issues = this.allIssues();
    if (issues.some((i) => i.level === 'error')) return 'blocked';
    if (issues.some((i) => i.level === 'warning') && !this.querySelector('[data-au-confirm]').checked) return 'confirm_needed';
    return false;
  }
  blocked() { return this.artBlocked() || (this.querySelector('[data-au-policy]').checked ? false : 'policy_required'); }
  explain(b) {
    this.querySelector('[data-au-status]').textContent = this.t[b];
    if (b === 'policy_required') { if (this.dialog.open) this.dialog.close(); const p = this.querySelector('[data-au-policy]'); p.scrollIntoView({ block: 'center', behavior: 'smooth' }); p.focus({ preventScroll: true }); }
    else if (b === 'art_required') { this.scrollIntoView({ block: 'start', behavior: 'smooth' }); this.querySelector('[data-au-open]').focus({ preventScroll: true }); }
    else this.openStudio();
  }
  guard(e) {
    if (e.target !== this.form) return;
    const b = this.blocked();
    if (b) { e.preventDefault(); e.stopImmediatePropagation(); this.explain(b); }
  }
  /** Every control that can put this item in the cart or start checkout. */
  buyButtons() {
    const f = this.form; if (!f) return [];
    const list = [...f.querySelectorAll('[type="submit"], [data-buy-now], .shopify-payment-button__button')];
    if (!this.dataset.standalone) list.push(...document.querySelectorAll('.sticky-buy .button'));
    return list;
  }
  onBuyClick(e) {
    const t = e.target.closest?.('button, [role="button"], .shopify-payment-button'); if (!t) return;
    const f = this.form; if (!f) return;
    const inForm = f.contains(t) || t.closest('.sticky-buy'); if (!inForm) return;
    const isBuy = t.matches('[type="submit"], [data-buy-now], .sticky-buy .button') || t.closest('.shopify-payment-button');
    if (!isBuy) return;
    const b = this.blocked();
    if (b) { e.preventDefault(); e.stopImmediatePropagation(); this.explain(b); return; }
    if (t.matches('[data-buy-now]')) { e.preventDefault(); this.buyNow(t); }
  }
  /** Theme Buy it now: native accelerated checkout drops file properties and linked lines, so add to cart
   * with the same FormData (fires `formdata`, so QA/Design lines join) then go to /checkout. */
  async buyNow(btn) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(`${window.routes?.cart_add_url || '/cart/add'}.js`, { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(this.form) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.description || j.message || this.t.buy_now_error); }
      window.location.href = `${window.Shopify?.routes?.root || '/'}checkout`;
    } catch (err) {
      btn.removeAttribute('aria-busy');
      const el = this.form.querySelector('[data-form-error]') || this.querySelector('[data-au-status]');
      el.hidden = false; el.textContent = err.message || this.t.buy_now_error;
    }
  }
  applyGate() {
    const b = this.blocked(); const statusId = this.querySelector('[data-au-status]').id;
    this.classList.toggle('is-ready', !b);
    this.buyButtons().forEach((btn) => {
      if (b) {
        btn.setAttribute('aria-disabled', 'true'); btn.dataset.auBlocked = 'true'; btn.title = this.t[b];
        const d = (btn.getAttribute('aria-describedby') || '').split(' ').filter(Boolean); if (!d.includes(statusId)) btn.setAttribute('aria-describedby', [...d, statusId].join(' '));
      } else if (btn.dataset.auBlocked) {
        delete btn.dataset.auBlocked; btn.removeAttribute('title'); btn.removeAttribute('aria-disabled');
      }
    });
    this.form?.querySelectorAll('.shopify-payment-button').forEach((w) => w.classList.toggle('is-au-blocked', !!b));
  }


  /* ---------- render ---------- */
  /** Checklist rows for one side, mapped from the preflight issues. Returns { rows, notes }. */
  checklist(k) {
    const s = this.state[k]; const sp = this.cfg.special; const doc = this.doc; const used = new Set();
    const lv = (l) => ({ error: 'err', warning: 'warn', ok: 'ok', info: 'review' }[l] || 'review');
    const pick = (keys) => s.issues.filter((i) => keys.includes(i.key));
    const row = (id, label, detail, keys, fallback, fix) => {
      const hits = pick(keys); hits.forEach((i) => used.add(i));
      let st = fallback; let text = detail;
      hits.forEach((i) => { const l = lv(i.level); if (LEVEL_RANK[l] >= LEVEL_RANK[st] || st === 'wait') { st = l; if (i.level !== 'ok') text = i.text; } });
      return { id, label, detail: text, st, fix: st === 'warn' || st === 'err' ? (typeof fix === 'function' ? fix(hits) : fix) : null };
    };
    if (s.phase !== 'done') {
      const st = s.phase === 'empty' ? 'wait' : 'run';
      const base = [['size', this.t.ck_size], ['dpi', this.t.ck_dpi], ['format', this.t.ck_format], ['safe', this.t.ck_safe]];
      return { rows: base.map(([id, label]) => ({ id, label, detail: '', st })), notes: [] };
    }
    const fmtErr = pick(['bad_format', 'too_large', 'err_upload']);
    const rows = [];
    rows.push(row('format', this.t.ck_format, s.ext.toUpperCase(), ['bad_format', 'too_large', 'err_upload'], 'ok', 'replace'));
    if (fmtErr.length) return { rows, notes: [] };
    rows.push(row('size', this.t.ck_size, doc ? fmt(this.t.ck_size_detail, { w: r2(doc.w), h: r2(doc.h) }) : this.t.no_template, ['pdf_ok', 'pdf_no_bleed', 'pdf_size', 'orientation', 'no_template'], s.source || s.pdf ? 'ok' : 'review', (h) => (h.some((i) => i.key === 'orientation') ? 'autorotate' : 'replace')));
    if (s.pdf) rows.push({ id: 'dpi', label: this.t.ck_dpi, detail: this.t.ck_dpi_vector, st: 'review' });
    else rows.push(row('dpi', this.t.ck_dpi, fmt(this.t.ck_dpi_detail, { dpi: this.cfg.warnDpi }), ['dpi_ok', 'dpi_low', 'dpi_too_low'], s.source ? 'ok' : 'review', 'replace'));
    if (!s.pdf && s.source) { const rot = s.rot % 180 !== 0; const ar = rot ? s.pxH / s.pxW : s.pxW / s.pxH; rows.push(row('ratio', this.t.ck_ratio, doc ? `${r2(ar)} · ${this.t.template_short} ${r2(doc.w / doc.h)}` : `${r2(ar)}`, ['aspect'], 'ok', 'fit')); }
    if (sp.has('apparel_area')) {
      rows.push(row('area', this.t.ck_area, this.t.lg_area, ['apparel'], 'ok', 'fit'));
      rows.push({ id: 'bg', label: this.t.ck_bg, detail: '', st: s.ext === 'png' ? 'ok' : 'review' });
    } else rows.push({ id: 'safe', label: this.t.ck_safe, detail: fmt(this.t.ck_safe_detail, { safe: this.cfg.safe }), st: 'review' });
    if (sp.has('folds')) rows.push(row('folds', this.t.ck_folds, '', ['folds'], 'review'));
    if (sp.has('die_cut')) rows.push(row('contour', this.t.ck_contour, '', ['die_cut'], 'review', 'fit'));
    if (num(this.spec?.sleeve_in)) rows.push({ id: 'sleeve', label: this.t.ck_sleeve, detail: '', st: 'review' });
    const notes = s.issues.filter((i) => !used.has(i) && i.level !== 'ok').map((i) => ({ ...i, side: k }));
    return { rows, notes };
  }
  /** Counts of errors/warnings across the needed sides. */
  counts() {
    const issues = this.allIssues().filter((i) => i.key !== 'missing_file');
    return { err: issues.filter((i) => i.level === 'error').length, warn: issues.filter((i) => i.level === 'warning').length, any: SIDES.some((k) => this.state[k].file) };
  }
  summaryText(n) {
    if (this.busy) return this.t.analyzing;
    if (!n.any) return this.t.sum_empty;
    if (n.err) return fmt(n.err === 1 ? this.t.sum_err_one : this.t.sum_err, { n: n.err });
    if (n.warn) return fmt(n.warn === 1 ? this.t.sum_warn_one : this.t.sum_warn, { n: n.warn });
    return this.t.sum_pass;
  }
  sideStatus(k) {
    const s = this.state[k];
    if (!s.file) return { cls: 'pend', label: this.t.badge_needed, ic: 'circle-dashed', dot: '' };
    if (s.phase === 'uploading' || s.phase === 'analyzing') return { cls: 'run', label: this.t.badge_checking, ic: 'loader-circle', dot: '' };
    const e = s.issues.filter((i) => i.level === 'error').length; const w = s.issues.filter((i) => i.level === 'warning').length;
    if (e) return { cls: 'err', label: fmt(e === 1 ? this.t.badge_err_one : this.t.badge_err, { n: e }), ic: 'circle-x', dot: 'err' };
    if (w) return { cls: 'warn', label: fmt(w === 1 ? this.t.badge_warn_one : this.t.badge_warn, { n: w }), ic: 'triangle-alert', dot: 'warn' };
    return { cls: 'ok', label: this.t.badge_ready, ic: 'circle-check', dot: 'ok' };
  }
  badge(st) { return `<span class="au-badge au-badge--${st.cls}">${icon(st.ic, 14, st.cls === 'run' ? 'au-spin' : '')}<span>${esc(st.label)}</span></span>`; }
  renderProgress() {
    const s = this.side; const bar = this.querySelector('[data-au-up-bar]');
    bar.setAttribute('aria-valuenow', s.progress); bar.style.setProperty('--p', `${s.progress}%`);
    const mb = (b) => r2(b / 1048576);
    if (s.file) this.querySelector('[data-au-up-text]').textContent = fmt(this.t.uploading, { file: s.file.name, p: s.progress, x: mb((s.file.size * s.progress) / 100), y: mb(s.file.size) });
    SIDES.forEach((k) => { const fb = this.querySelector(`[data-au-tile="${k}"] [data-au-filebar]`); fb.hidden = this.state[k].phase !== 'uploading'; fb.style.setProperty('--p', `${this.state[k].progress}%`); });
  }
  update() {
    const issues = this.allIssues();
    const needed = this.cfg.sides; const neededSides = needed === 2 ? SIDES : ['front'];
    const done = neededSides.filter((k) => this.state[k].file).length;
    this.querySelectorAll('[data-au-count]').forEach((e) => { e.textContent = done ? fmt(this.t.files_uploaded, { done, total: needed }) : ''; });
    this.querySelector('[data-au-sides-count]').textContent = fmt(this.t.sides_count, { n: done, t: needed });
    const doc = this.doc;
    const tpl = this.trim ? fmt(this.t.template, { w: r2(this.trim.w), h: r2(this.trim.h), bw: r2(doc.w), bh: r2(doc.h), dpi: this.cfg.minDpi }) : this.t.no_template;
    const name = this.spec?.label || this.profile?.name;
    const specLine = name && this.trim ? fmt(this.t.spec_line, { name, w: r2(this.trim.w), h: r2(this.trim.h), sides: needed, dpi: this.cfg.minDpi }) : '';
    this.querySelector('[data-au-template-label]').textContent = specLine ? `${specLine}. ${tpl}` : tpl;
    const title = decodeEntities(this.dataset.productTitle || ''); const ts = parseSize(title);
    const titleHasSize = ts && this.trim && ((Math.abs(ts.w - this.trim.w) < 0.01 && Math.abs(ts.h - this.trim.h) < 0.01) || (Math.abs(ts.w - this.trim.h) < 0.01 && Math.abs(ts.h - this.trim.w) < 0.01));
    let specTail = specLine.replace(/^[^:]*:\s*/, '') || (this.trim ? `${r2(this.trim.w)}" × ${r2(this.trim.h)}"` : '');
    if (titleHasSize) specTail = specTail.split(' · ').slice(1).join(' · ');
    const eb = this.querySelector('[data-au-eyebrow]'); eb.textContent = [title, specTail].filter(Boolean).join(' · '); eb.title = eb.textContent;
    const n = this.counts();
    // product card
    this.classList.toggle('has-art', n.any);
    const psBadge = this.querySelector('[data-au-ps-badge]');
    const overall = !n.any ? null : this.busy ? { cls: 'run', label: this.t.badge_checking, ic: 'loader-circle' } : n.err ? { cls: 'err', label: fmt(n.err === 1 ? this.t.badge_err_one : this.t.badge_err, { n: n.err }), ic: 'circle-x' } : n.warn && !this.querySelector('[data-au-confirm]').checked ? { cls: 'warn', label: this.t.needs_review, ic: 'triangle-alert' } : done < needed ? { cls: 'pend', label: this.t.badge_needed, ic: 'circle-dashed' } : { cls: 'ok', label: this.t.badge_ready, ic: 'circle-check' };
    psBadge.innerHTML = overall ? this.badge(overall) : '';
    const psList = this.querySelector('[data-au-ps-list]'); psList.replaceChildren();
    if (n.any) neededSides.forEach((k) => {
      const s = this.state[k]; const li = el('li');
      li.innerHTML = `<span class="au-thumb">${icon('file-image', 20)}</span><span style="min-width:0"><b></b><small></small></span>${this.badge(this.sideStatus(k))}`;
      li.querySelector('b').textContent = s.file ? s.file.name : this.t[k];
      li.querySelector('small').textContent = s.file ? `${this.t[k]} · ${s.ext.toUpperCase()} · ${r2(s.file.size / 1048576)} MB` : this.t.badge_needed;
      if (s.source) this.thumb(li.querySelector('.au-thumb'), s);
      psList.append(li);
    });
    this.querySelector('[data-au-open-replace]').hidden = !n.any;
    // tiles + tab badges
    SIDES.forEach((k) => {
      const tile = this.querySelector(`[data-au-tile="${k}"]`); const s = this.state[k]; const st = this.sideStatus(k);
      tile.classList.toggle('is-done', !!s.file); tile.classList.toggle('is-active', k === this.active);
      ['ok', 'warn', 'err'].forEach((c) => tile.classList.toggle(`is-${c}`, st.cls === c));
      this.querySelector(`[data-au-side-badge="${k}"]`).innerHTML = this.badge(st);
      tile.querySelector('.au-dz').hidden = !!s.file;
      tile.querySelector('[data-au-file]').hidden = !s.file;
      const fnEl = tile.querySelector('[data-au-filename]'); const th = tile.querySelector('.au-thumb');
      fnEl.textContent = s.file ? s.file.name : this.t.badge_needed; fnEl.title = s.file ? s.file.name : '';
      tile.querySelector('[data-au-filemeta]').textContent = s.file ? `${s.ext.toUpperCase()} · ${r2(s.file.size / 1048576)} MB${s.pxW && !s.pdf ? ` · ${s.pxW}×${s.pxH}px` : ''}` : '';
      if (s.file && s.source) this.thumb(th, s); else if (th.dataset.for !== '') { th.innerHTML = icon('file-image', 22); th.dataset.for = ''; }
      const tb = this.querySelector(`[data-au-tab-badge="${k}"]`);
      tb.innerHTML = st.dot ? this.badge(st) : '';
    });
    // checklist + notes for the active side
    const vw = this.querySelector('[data-au-viewing]'); if (vw) vw.textContent = this.t[`${this.active}_side`];
    const s = this.side; const { rows, notes } = this.checklist(this.active);
    const ck = this.querySelector('[data-au-checklist]'); ck.replaceChildren();
    const ICON_FOR = { ok: 'circle-check', warn: 'triangle-alert', err: 'circle-x', wait: 'circle-dashed', run: 'loader-circle', review: 'eye' };
    rows.forEach((r) => {
      const li = el('li'); li.dataset.ck = r.id; li.tabIndex = -1;
      li.innerHTML = `<span class="au-ic--${r.st}">${icon(ICON_FOR[r.st], 20, r.st === 'run' ? 'au-spin' : '')}</span><span><b></b><small></small></span><span class="au__st au__st--${r.st}">${esc(this.t[`st_${r.st}`])}</span>`;
      li.querySelector('b').textContent = r.label; li.querySelector('small').textContent = r.detail || '';
      if (r.fix) {
        const map = { fit: ['scan', this.t.fix_fit], replace: ['replace', this.t.fix_replace], autorotate: ['rotate-cw', this.t.auto_rotate] }; const [ic, label] = map[r.fix];
        const b = el('button', 'au-btn au-btn--outline au-btn--sm au-fix', `${icon(ic, 16)}<span></span>`); b.type = 'button'; b.dataset.auFix = r.fix; b.dataset.side = this.active; b.querySelector('span').textContent = label;
        b.addEventListener('click', () => this.act(r.fix, b)); li.append(b);
      }
      ck.append(li);
    });
    const ul = this.querySelector('[data-au-warnings]'); ul.replaceChildren();
    const otherNotes = SIDES.filter((k) => k !== this.active && neededSides.includes(k)).flatMap((k) => this.state[k].issues.filter((i) => i.level === 'error' || i.level === 'warning').map((i) => ({ ...i, side: k })));
    [...notes, ...otherNotes].forEach((i) => { const li = el('li', `is-${i.level}`); li.textContent = `${this.t[i.side]}: ${i.text}`; ul.append(li); });
    this.querySelector('[data-au-notes-wrap]').hidden = !ul.children.length;
    const total = n.err + n.warn;
    this.querySelector('[data-au-badge]').innerHTML = !n.any ? '' : this.busy ? this.badge({ cls: 'run', label: this.t.badge_checking, ic: 'loader-circle' }) : n.err ? this.badge({ cls: 'err', label: fmt(n.err === 1 ? this.t.badge_err_one : this.t.badge_err, { n: n.err }), ic: 'circle-x' }) : n.warn ? this.badge({ cls: 'warn', label: fmt(n.warn === 1 ? this.t.badge_warn_one : this.t.badge_warn, { n: n.warn }), ic: 'triangle-alert' }) : this.badge({ cls: 'ok', label: this.t.badge_ready, ic: 'circle-check' });
    const sum = this.querySelector('[data-au-summary]'); sum.textContent = this.summaryText(n); sum.className = `au__sum${!n.any || this.busy ? '' : n.err ? ' is-err' : n.warn ? ' is-warn' : ' is-ok'}`;
    // stage overlays
    const hasFile = !!s.file;
    this.drop.hidden = hasFile;
    this.querySelector('[data-au-drop-title]').textContent = this.t[`drop_canvas_${this.active}`];
    this.querySelector('[data-au-ovl-up]').hidden = s.phase !== 'uploading';
    this.querySelector('[data-au-ovl-an]').hidden = s.phase !== 'analyzing';
    const errI = s.phase === 'done' && s.issues.find((i) => i.level === 'error');
    this.querySelector('[data-au-errbar]').hidden = !errI; if (errI) this.querySelector('[data-au-errbar-text]').textContent = errI.text;
    this.classList.toggle('is-empty-side', !s.source);
    this.renderProgress();
    // legend per mode
    const sp = this.cfg.special; const show = (k, v) => { const li = this.querySelector(`[data-lg="${k}"]`); if (li) li.hidden = !v; };
    const ap = sp.has('apparel_area');
    show('bleed', !ap); show('cut', !ap && !sp.has('die_cut')); show('safe', !ap); show('fold', sp.has('folds')); show('contour', sp.has('die_cut')); show('area', ap); show('sleeve', !!num(this.spec?.sleeve_in));
    this.querySelector('[data-au-orient-val]').textContent = this.landscape ? this.t.landscape : this.t.portrait;
    // footer: ack + approve
    const ackRow = this.querySelector('[data-au-ack]'); const ack = this.querySelector('[data-au-confirm]');
    ackRow.hidden = !(n.warn && !n.err && !this.busy);
    this.querySelector('[data-au-ack-text]').textContent = fmt(n.warn === 1 ? this.t.ack_one : this.t.ack, { n: n.warn });
    if (ackRow.hidden && ack.checked && !n.warn) ack.checked = false;
    const ab = this.busy ? 'busy' : this.artBlocked(); const ap2 = this.querySelector('[data-au-approve]');
    if (ab) { ap2.setAttribute('aria-disabled', 'true'); this.querySelector('[data-au-why]').textContent = `${this.t.approve_why} ${ab === 'busy' ? this.t.analyzing : this.t[ab]}`; }
    else { ap2.removeAttribute('aria-disabled'); this.querySelector('[data-au-why]').textContent = ''; }
    this.querySelector('[data-au-scale]').value = Math.round(s.scale * 100);
    // product-card modes (unchanged behaviour)
    const brief = this.brief; const later = this.mode === 'later' || brief;
    const laterRow = this.querySelector('[data-au-later-row]'); if (laterRow) laterRow.hidden = brief;
    this.querySelector('[data-au-brief]').hidden = !brief;
    if (brief) this.querySelector('[data-au-brief-text]').textContent = fmt(this.t.brief_help, { tier: this.design.name });
    const laterBox = this.querySelector('[data-au-later]'); if (laterBox) laterBox.hidden = !(this.mode === 'later') || brief;
    this.querySelector('[data-au-upload-ui]').hidden = later;
    const lp = this.querySelector('[data-au-later-prop]'); if (lp) { lp.disabled = !later; lp.value = brief ? BRIEF_PROP : 'Will send after checkout'; }
    const pol = this.querySelector('[data-au-policy]'); const pp = this.querySelector('[data-au-policy-prop]');
    pp.disabled = !pol.checked; if (pol.checked && !pp.value) pp.value = `Accepted ${new Date().toISOString()}`; if (!pol.checked) pp.value = '';
    this.querySelectorAll('[data-au-input]').forEach((i) => { i.disabled = later; });
    const qaRow = this.querySelector('[data-au-qa-row]'); if (qaRow) { qaRow.hidden = this.qaHidden; this.querySelector('[data-au-qa]').disabled = this.qaHidden; }
    const qb = this.querySelector('[data-au-qa-badge]'); if (qb) qb.hidden = !later;
    this.writeProps(issues);
    if (later) this.querySelectorAll('[data-au-prop]').forEach((e) => { e.disabled = true; });
    const b = this.blocked(); this.querySelector('[data-au-status]').textContent = b ? this.t[b] : this.t.gate_ok;
    this.applyGate(); this.draw();
  }
  /** Small preview of the art in a thumb slot (cached per source). */
  thumb(slot, s) {
    if (!s.thumbUrl) { const c = document.createElement('canvas'); const k = 96 / Math.max(s.pxW, s.pxH); c.width = Math.max(1, Math.round(s.pxW * k)); c.height = Math.max(1, Math.round(s.pxH * k)); c.getContext('2d').drawImage(s.source, 0, 0, c.width, c.height); s.thumbUrl = c.toDataURL(); }
    if (slot.dataset.for === s.thumbUrl.slice(-32)) return;
    slot.innerHTML = `<img src="${s.thumbUrl}" alt="">`; slot.dataset.for = s.thumbUrl.slice(-32);
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
    const box = this.wrap.getBoundingClientRect(); const avail = Math.max(160, box.width - 32) * this.zoom; const maxH = Math.max(160, box.height - 32) * this.zoom;
    const pad = 20 * dpr; const ppi = Math.min((avail * dpr - 2 * pad) / doc.w, (maxH * dpr - 2 * pad) / doc.h); this.ppi = ppi;
    const W = Math.round(doc.w * ppi + 2 * pad); const H = Math.round(doc.h * ppi + 2 * pad);
    this.canvas.width = W; this.canvas.height = H; this.canvas.style.width = `${W / dpr}px`; this.canvas.style.height = `${H / dpr}px`;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.fillRect(pad, pad, doc.w * ppi, doc.h * ppi);
    const s = this.side; const b = this.cfg.bleed * ppi; const sf = (this.cfg.bleed + this.cfg.safe) * ppi;
    const sp = this.cfg.special; const ap = sp.has('apparel_area'); const die = sp.has('die_cut');
    if (s.source && this.doc) {
      const rotated = s.rot % 180 !== 0; const aw = rotated ? s.pxH : s.pxW; const ah = rotated ? s.pxW : s.pxH;
      const k = (ap ? Math.min((doc.w * ppi) / aw, (doc.h * ppi) / ah) : Math.max((doc.w * ppi) / aw, (doc.h * ppi) / ah)) * s.scale;
      ctx.save(); ctx.translate(pad + (doc.w / 2 + s.x) * ppi, pad + (doc.h / 2 + s.y) * ppi); ctx.rotate((s.rot * Math.PI) / 180);
      ctx.drawImage(s.source, (-s.pxW * k) / 2, (-s.pxH * k) / 2, s.pxW * k, s.pxH * k); ctx.restore();
    }
    const rr = (inset, r) => { const x = pad + inset; const y = pad + inset; const w = doc.w * ppi - 2 * inset; const h = doc.h * ppi - 2 * inset; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
    const dieR = Math.min(doc.w, doc.h) * ppi * 0.12;
    // mask outside the cut line (contour for die-cut)
    if (!ap) { ctx.save(); ctx.fillStyle = `rgba(255,255,255,${this.mask})`; ctx.beginPath(); ctx.rect(0, 0, W, H); if (die && ctx.roundRect) ctx.roundRect(pad + b, pad + b, doc.w * ppi - 2 * b, doc.h * ppi - 2 * b, dieR); else ctx.rect(pad + b, pad + b, doc.w * ppi - 2 * b, doc.h * ppi - 2 * b); ctx.fill('evenodd'); ctx.restore(); }
    const line = (color, width, dash, path) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.setLineDash(dash.map((d) => d * dpr)); path(); ctx.stroke(); ctx.restore(); };
    const label = (txt, x, y, bg = '#000', fg = '#fff') => { ctx.save(); ctx.font = `700 ${11 * dpr}px system-ui, sans-serif`; const w = ctx.measureText(txt).width + 10 * dpr; ctx.fillStyle = bg; ctx.fillRect(x, y, w, 16 * dpr); ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + 5 * dpr, y + 8 * dpr); ctx.restore(); };
    if (ap) {
      if (this.showGuides) { line(COLORS.safe, 1.5, [6, 4], () => rr(0, 0)); label(this.t.lg_area, pad + 6 * dpr, pad + 6 * dpr, COLORS.safe); }
    } else {
      if (this.showGuides) { line(COLORS.bleed, 1.5, [4, 3], () => rr(0, 0)); line(COLORS.safe, 1.5, [6, 4], () => rr(sf, die ? Math.max(0, dieR - this.cfg.safe * ppi) : 0)); }
      if (this.showCut) { if (die) line('#FB56D6', 3, [], () => rr(b, dieR)); else line(COLORS.cut, 2, [], () => rr(b, 0)); }
    }
    if (sp.has('folds') && this.trim && this.showGuides) {
      foldPositions(this.cfg.panels, sp.panelCount, this.trim.w).forEach((fx) => {
        const x = pad + b + fx * ppi; line('#000', 1.5, [2, 3], () => { ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, pad + doc.h * ppi); });
        label(this.t.lg_fold, x - 16 * dpr, pad + doc.h * ppi - 22 * dpr);
      });
    }
    const sleeve = num(this.spec?.sleeve_in);
    if (sleeve && this.showGuides) {
      const w = sleeve * ppi; ctx.save(); ctx.beginPath(); ctx.rect(pad, pad, w, doc.h * ppi); ctx.clip(); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5 * dpr;
      for (let i = -doc.h * ppi; i < w + doc.h * ppi; i += 8 * dpr) { ctx.beginPath(); ctx.moveTo(pad + i, pad); ctx.lineTo(pad + i + doc.h * ppi, pad + doc.h * ppi); ctx.stroke(); }
      ctx.restore(); label(this.t.lg_sleeve, pad + 4 * dpr, pad + 6 * dpr);
    }
    // large-format scale chip: real inches vs on-screen inches (96 CSS px per inch)
    const chip = this.querySelector('[data-au-scale-chip]');
    const showChip = sp.has('large_format') && this.trim; chip.hidden = !showChip;
    if (showChip) { const ratio = Math.max(1, Math.round((96 * dpr) / ppi)); chip.querySelector('span').textContent = fmt(this.t.scale_chip, { n: ratio, h: `${r2(this.trim.h)}"` }); }
    if (this.magnify && this.mag) {
      const r = 70 * dpr; const z = 3; const { x, y } = this.mag;
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(this.canvas, x - r / z, y - r / z, (2 * r) / z, (2 * r) / z, x - r, y - r, 2 * r, 2 * r); ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#111'; ctx.stroke();
    }
  }
}
if (!customElements.get('artwork-uploader')) customElements.define('artwork-uploader', ArtworkUploader);
