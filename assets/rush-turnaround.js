/* PRINTR production-time (turnaround) selector.
 * Two data sources (see snippets/rush-turnaround.liquid and docs/turnaround.md):
 *  - mode "product": product metafield printr.turnaround: an included default tier (2nd Day where the supplier offers it,
 *    else the real minimum such as 4 business days) plus optional paid tiers (Next Day +$5). The fee is FLAT per cart line.
 *  - mode "variant": legacy per-variant surcharges (printr.rush_2bd / printr.rush_nbd), charged per unit.
 * Standard is included in the variant price. 2 Business Days / Next Business Day add a surcharge that is charged
 * as a NESTED cart line of the hidden "Rush Production" fee product ($0.01 variant, quantity = surcharge in cents
 * x line quantity), added in the same /cart/add call as the print item. Nested lines are removed by Shopify when
 * the parent line is removed; theme.js also reconciles fee quantity/orphans (rush* helpers there).
 * The print line gets the visible property "Turnaround" plus hidden _rush_* markers used for reconciliation. */
const fmt = (s, vars = {}) => String(s || '').replace(/\{\{?\s*(\w+)\s*\}?\}/g, (m, k) => (k in vars ? vars[k] : m));

const formatMoney = (cents, format) => {
  const fmtNum = (n, dec, th, sep) => { const [i, d] = (n / 100).toFixed(dec).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, th) + (d ? sep + d : ''); };
  return String(format || '${{amount}}').replace(/\{\{\s*(\w+)\s*\}\}/, (_, k) => {
    if (k === 'amount_no_decimals') return fmtNum(cents, 0, ',', '.');
    if (k === 'amount_with_comma_separator') return fmtNum(cents, 2, '.', ',');
    if (k === 'amount_no_decimals_with_comma_separator') return fmtNum(cents, 0, '.', ',');
    return fmtNum(cents, 2, ',', '.');
  });
};

/** Convert flat product FormData into items[0][..] once (same idea as design-service.js / artwork-uploader.js); return next free index.
 * properties[X] becomes items[0][properties][X] (the bracket matters: "items[0]properties[X]" is not parsed as a line property). */
export function toItems(fd) {
  if (!fd.has('items[0][id]')) {
    const entries = [...fd.entries()];
    entries.forEach(([k]) => fd.delete(k));
    entries.forEach(([k, v]) => {
      if (k === 'id' || k === 'quantity' || k === 'selling_plan') fd.append(`items[0][${k}]`, v);
      else if (k.startsWith('properties[')) fd.append(`items[0][properties]${k.slice('properties'.length)}`, v);
      else fd.append(k, v);
    });
    if (!fd.has('items[0][quantity]')) fd.append('items[0][quantity]', '1');
  }
  let n = 0; while (fd.has(`items[${n}][id]`)) n++;
  return n;
}

/** Canonical (English) values for the order's "Turnaround" property, so production reads the same text in any storefront language. */
export const TURNAROUND_VALUE = {
  standard: (days) => `Standard (${days} business days)`,
  std: (days) => `Standard (${days} business days)`,
  '2bd': (days, mode) => (mode === 'product' ? '2nd Day (2 business days)' : '2 Business Days (rush)'),
  nbd: (days, mode) => (mode === 'product' ? 'Next Day (next business day)' : 'Next Business Day (rush)')
};
export const TURNAROUND_PROP = 'Turnaround';
export const canonicalValue = (tier, days, mode) => (TURNAROUND_VALUE[tier] || TURNAROUND_VALUE.std)(days, mode);

/** Section id -> last tier the customer picked, so the choice survives the section re-render on variant change. */
const picked = new Map();

/**
 * Add the turnaround choice to a product FormData. Pure function (exported for tests).
 * Always records the visible "Turnaround" property (also for the included default tier); a paid tier also adds the nested fee line.
 * @param {FormData} fd
 * @param {{variant:number, standardDays:number, title:string, variantTitle:string, mode:string, defaultTier:string, tiers:Array}} data
 * @param {string} tier tier key (e.g. 'standard' | 'std' | '2bd' | 'nbd')
 * @param {string[]} [extraTurnKeys] other property names that also carry a turnaround (e.g. the brochure configurator's localized label)
 * @returns {{added:boolean, reason?:string}}
 */
export function applyRushToFormData(fd, data, tier, extraTurnKeys = []) {
  const flat = !fd.has('items[0][id]');
  const idKey = flat ? 'id' : 'items[0][id]';
  if (String(fd.get(idKey) || '') !== String(data.variant)) return { added: false, reason: 'variant-mismatch' };
  const tiers = data.tiers || [];
  const t = tiers.find((x) => x.k === tier) || tiers.find((x) => x.k === data.defaultTier);
  const keys = [TURNAROUND_PROP, ...extraTurnKeys.filter((k) => k && k !== TURNAROUND_PROP)];
  const pre = flat ? '' : 'items[0]';
  const days = t && t.days ? t.days : data.standardDays;
  if (!t || !(t.cents > 0) || !t.fee) {
    // Included tier: record it on the order line, nothing else to add.
    keys.forEach((k) => fd.delete(`${pre}properties[${k}]`));
    fd.set(`${pre}properties[${TURNAROUND_PROP}]`, canonicalValue(t ? t.k : 'std', days, data.mode));
    return { added: false, reason: t && t.k === data.defaultTier ? 'default' : 'not-offered' };
  }
  const n = toItems(fd);
  const qty = Math.max(1, parseInt(fd.get('items[0][quantity]'), 10) || 1);
  const link = `rt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  keys.forEach((k) => fd.delete(`items[0][properties][${k}]`));
  fd.set(`items[0][properties][${TURNAROUND_PROP}]`, canonicalValue(t.k, days, data.mode));
  fd.set('items[0][properties][_rush_link]', link);
  fd.set('items[0][properties][_rush_tier]', t.k);
  fd.set('items[0][properties][_rush_cents]', String(t.cents));
  fd.set('items[0][properties][_rush_fee_variant]', String(t.fee));
  if (t.flat) { fd.set('items[0][properties][_rush_flat]', '1'); fd.set('items[0][properties][_rush_units]', String(t.units)); }
  const forText = data.variantTitle ? `${data.title} – ${data.variantTitle}` : data.title;
  fd.append(`items[${n}][id]`, String(t.fee));
  fd.append(`items[${n}][quantity]`, String(t.flat ? t.units : t.units * qty));
  fd.append(`items[${n}][parent_id]`, String(data.variant));
  fd.append(`items[${n}][properties][_rush_link]`, link);
  fd.append(`items[${n}][properties][_rush_fee]`, t.k);
  fd.append(`items[${n}][properties][_for]`, forText);
  return { added: true };
}

class RushTurnaround extends HTMLElement {
  connectedCallback() {
    this.data = JSON.parse(this.querySelector('[data-rush-data]').textContent);
    // The | t filter HTML-escapes (isn't -> isn&#39;t); decode once since most strings go through textContent.
    const dec = (v) => { const ta = document.createElement('textarea'); ta.innerHTML = String(v); return ta.value; };
    this.t = Object.fromEntries(Object.entries(this.data.strings || {}).map(([k, v]) => [k, dec(v)]));
    this.radios = [...this.querySelectorAll('[data-rush-opt]')];
    this.radios.forEach((r) => r.addEventListener('change', () => { if (r.checked) this.choose(r.value, true); }));
    // formdata does not bubble; capture at document so the hook survives the buy form being re-rendered on variant change.
    // getAttribute('id'): on a product form, form.id is the <input name="id"> (named-control shadowing), not the form's id.
    this.onFd = (e) => { if (e.target?.getAttribute?.('id') === this.dataset.formId) this.onFormData(e.formData); };
    document.addEventListener('formdata', this.onFd, true);
    // Variant changes that do NOT re-render this block (e.g. the brochure configurator) reload it for the new variant.
    this.onVariant = (e) => {
      const d = e.detail || {};
      if (d.sectionId && d.sectionId !== this.dataset.section) return;
      if (String(d.variantId) !== String(this.data.variant)) this.reload(d.variantId);
      else this.paint();
    };
    document.addEventListener('variant:change', this.onVariant);
    // Restore the previous choice after a re-render; fall back to Standard (and say so) when it isn't offered now.
    const prev = picked.get(this.dataset.section);
    const def = this.data.defaultTier || 'standard';
    if (prev && prev !== def) {
      const r = this.radios.find((x) => x.value === prev);
      if (r) { r.checked = true; this.choose(prev, false); }
      else { this.choose(def, false); this.announceReset(prev); }
    } else this.choose(def, false);
  }
  disconnectedCallback() {
    document.removeEventListener('formdata', this.onFd, true);
    document.removeEventListener('variant:change', this.onVariant);
  }
  get tier() { return this.radios.find((r) => r.checked)?.value || this.data.defaultTier || 'standard'; }
  get cfg() { return (this.data.tiers || []).find((x) => x.k === this.tier); }
  get root() { return document.getElementById(`shopify-section-${this.dataset.section}`) || this.closest('.section') || document; }
  label(tier) {
    if (this.data.mode === 'product') return tier === '2bd' ? this.t.tier_2bd : tier === 'nbd' ? this.t.tier_nbd : this.t.tier_std;
    return tier === '2bd' ? this.t.two_day : tier === 'nbd' ? this.t.next_day : this.t.standard;
  }
  get qty() { const f = document.getElementById(this.dataset.formId); const q = parseInt(f && f.querySelector('[name="quantity"]')?.value, 10); return q > 0 ? q : 1; }
  money(c) { return formatMoney(c, this.data.money); }
  choose(tier, user) {
    picked.set(this.dataset.section, tier);
    if (user) {
      const reset = this.querySelector('[data-rush-reset]'); if (reset) reset.hidden = true;
      try { window.Shopify?.analytics?.publish?.('rush_turnaround_selected', { tier, variant: this.data.variant }); } catch (e) { /* noop */ }
    }
    this.paint();
    this.dispatchEvent(new CustomEvent('rush:change', { bubbles: true, detail: { tier, cents: this.cents, variantId: this.data.variant, sectionId: this.dataset.section } }));
  }
  get cents() { const o = this.cfg; return o && o.fee ? o.cents : 0; }
  /** Price display = variant price + surcharge, everywhere this section shows the variant price (flat fees: only at quantity 1). */
  paint() {
    const o = this.cfg; const fee = this.cents; const flat = !!(o && o.flat);
    const total = flat ? this.data.price * this.qty + fee : this.data.price + fee;
    const showInPrice = !flat || this.qty === 1;
    const tot = this.querySelector('[data-rush-total]');
    if (tot) tot.innerHTML = fee ? `${fmt(this.t.total, { option: this.label(this.tier), price: `<strong>${this.money(total)}</strong>` })}` : '';
    this.root.querySelectorAll('[data-price-amount]').forEach((el) => {
      // Only plain prices carry data-price-amount (not "From …" or sale prices), so this always shows the selected variant.
      el.textContent = this.money(showInPrice ? this.data.price + fee : this.data.price);
      const box = el.closest('.price'); if (!box) return;
      let note = box.querySelector('.price__rush');
      if (fee) {
        if (!note) { note = document.createElement('small'); note.className = 'price__rush'; box.appendChild(note); }
        note.textContent = fmt(flat ? this.t.flat_note : this.t.price_note, { option: this.label(this.tier), amount: this.money(fee) });
      } else if (note) note.remove();
    });
  }
  announceReset(prev) {
    const el = this.querySelector('[data-rush-reset]'); if (!el) return;
    el.textContent = fmt(this.t.reset, { option: this.label(prev) }); el.hidden = false;
  }
  async reload(variantId) {
    if (!variantId || this.loading === variantId) return;
    this.loading = variantId; this.setAttribute('aria-busy', 'true');
    try {
      const mine = this.closest('[data-swap="turnaround"]');
      await reloadTurnaroundSwap({
        productUrl: this.dataset.productUrl,
        sectionId: this.dataset.section,
        variantId,
        current: mine,
      });
    } catch (err) { console.error(err); } finally { if (this.isConnected) { this.removeAttribute('aria-busy'); this.loading = null; } }
  }
  onFormData(fd) {
    const res = applyRushToFormData(fd, this.data, this.tier, [this.t.configurator_turnaround]);
    if (!res.added && res.reason === 'variant-mismatch' && this.tier !== this.data.defaultTier) {
      // The form points at a different variant than this block (still reloading): never charge a stale surcharge.
      console.warn('[rush] variant mismatch; rush not added');
    }
  }
}
if (!customElements.get('rush-turnaround')) customElements.define('rush-turnaround', RushTurnaround);

/** Fetch the production-time block for a variant and swap it in. Also used when the
 *  current variant only has a plain line (no <rush-turnaround>), so a later option
 *  change that unlocks the selector still reloads the block. */
let swapLoading = null;
async function reloadTurnaroundSwap({ productUrl, sectionId, variantId, current }) {
  if (!variantId || swapLoading === variantId) return;
  swapLoading = variantId;
  try {
    const u = new URL(productUrl || location.pathname, location.href);
    const preview = new URLSearchParams(location.search).get('preview_theme_id');
    if (preview) u.searchParams.set('preview_theme_id', preview);
    u.searchParams.set('variant', String(variantId));
    if (sectionId) u.searchParams.set('section_id', sectionId);
    const html = await (await fetch(u)).text();
    const fresh = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-swap="turnaround"]');
    const mine = current || document.querySelector('[data-swap="turnaround"]');
    if (fresh && mine && swapLoading === variantId) mine.replaceWith(fresh);
  } finally {
    if (swapLoading === variantId) swapLoading = null;
  }
}

if (typeof window !== 'undefined' && !window.__printrTurnaroundSwapBound) {
  window.__printrTurnaroundSwapBound = true;
  document.addEventListener('variant:change', (e) => {
    const d = e.detail || {};
    if (!d.variantId) return;
    const root = (d.sectionId && document.getElementById(`shopify-section-${d.sectionId}`)) || document;
    // <rush-turnaround> reloads itself; this is only for the plain production-time line.
    if (root.querySelector('rush-turnaround')) return;
    const host = root.querySelector('[data-turnaround-host]');
    const mine = root.querySelector('[data-swap="turnaround"]');
    if (!mine) return;
    reloadTurnaroundSwap({
      productUrl: (host && host.dataset.productUrl) || location.pathname,
      sectionId: (host && host.dataset.section) || d.sectionId,
      variantId: d.variantId,
      current: mine,
    }).catch((err) => console.error(err));
  });
}
