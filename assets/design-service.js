/* PRINTR Design Service selector. Adds the chosen tier as a linked line in the same /cart/add call
 * (properties _parent_key + _for + Design tier), marks the print line "Design Service: <tier>",
 * and broadcasts `design:change` so the artwork uploader can adapt (brief mode, hide QA fee). */
const fmt = (s, vars = {}) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

/** Convert a flat product FormData (id, quantity, properties[..]) into items[0][..] once; return next free index. */
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

const formatMoney = (cents, format) => {
  const fmtNum = (n, dec, th, sep) => { const [i, d] = (n / 100).toFixed(dec).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, th) + (d ? sep + d : ''); };
  return String(format || '${{amount}}').replace(/\{\{\s*(\w+)\s*\}\}/, (_, k) => {
    if (k === 'amount_no_decimals') return fmtNum(cents, 0, ',', '.');
    if (k === 'amount_with_comma_separator') return fmtNum(cents, 2, '.', ',');
    if (k === 'amount_no_decimals_with_comma_separator') return fmtNum(cents, 0, '.', ',');
    return fmtNum(cents, 2, ',', '.');
  });
};

class DesignService extends HTMLElement {
  connectedCallback() {
    const data = JSON.parse(this.querySelector('[data-ds-data]').textContent);
    this.t = data.strings; this.money = data.money; this.variants = data.variants;
    this.variantId = this.dataset.variant;
    this.querySelectorAll('[data-ds-tier]').forEach((r) => r.addEventListener('change', () => { if (r.checked) this.select(r, true); }));
    // formdata does not bubble; capture at document so it survives the buy form being re-rendered on variant change.
    this.onFd = (e) => { if (e.target.id === this.dataset.formId) this.onFormData(e.formData); };
    document.addEventListener('formdata', this.onFd, true);
    this.onVariant = (e) => { if (!e.detail.sectionId || e.detail.sectionId === this.dataset.section) { this.variantId = e.detail.variantId; this.render(); } };
    document.addEventListener('variant:change', this.onVariant);
    this.onQty = (e) => { if (e.target.closest(`#${this.dataset.formId}`) && e.target.name === 'quantity') this.render(); };
    document.addEventListener('input', this.onQty); document.addEventListener('change', this.onQty);
    document.addEventListener('design:add-failed', (e) => { if (e.detail.formId === this.dataset.formId) this.querySelector('[data-ds-error]').hidden = false; });
    this.select(this.querySelector('[data-ds-tier]:checked'), false);
  }
  disconnectedCallback() {
    document.removeEventListener('formdata', this.onFd, true);
    document.removeEventListener('variant:change', this.onVariant);
    document.removeEventListener('input', this.onQty); document.removeEventListener('change', this.onQty);
  }
  get choice() { const r = this.querySelector('[data-ds-tier]:checked'); return r && r.value ? r : null; }
  get form() { return document.getElementById(this.dataset.formId); }
  select(r, user) {
    this.querySelector('[data-ds-error]').hidden = true;
    const c = this.choice;
    const detail = { formId: this.dataset.formId, sectionId: this.dataset.section, tier: c ? c.dataset.dsTier : null, name: c ? c.dataset.dsName : null, paid: !!c, hideQa: this.dataset.hideQa === 'true' };
    document.dispatchEvent(new CustomEvent('design:change', { detail }));
    if (user) this.track('design_service_selected', { tier: detail.tier || 'none', product: this.dataset.productHandle });
    this.render();
  }
  track(name, payload) {
    try { window.Shopify?.analytics?.publish?.(name, payload); } catch (e) { /* noop */ }
    document.dispatchEvent(new CustomEvent(name.replace(/_/g, ':'), { detail: payload }));
  }
  render() {
    const c = this.choice; const banner = this.querySelector('[data-ds-banner]'); const sub = this.querySelector('[data-ds-subtotal]');
    if (!c) { banner.hidden = true; sub.hidden = true; return; }
    let text = fmt(this.t.confirm, { tier: c.dataset.dsName });
    if (c.dataset.dsTier === 'touchup') {
      const refresh = this.querySelector('[data-ds-tier="refresh"]');
      if (refresh && !refresh.disabled) text += ` ${fmt(this.t.upsell, { diff: formatMoney(Number(refresh.dataset.dsPrice) - Number(c.dataset.dsPrice), this.money) })}`;
    }
    banner.textContent = text; banner.hidden = false;
    const v = this.variants.find((x) => String(x.id) === String(this.variantId)) || this.variants[0];
    const qty = Math.max(1, parseInt(this.form?.querySelector('[name="quantity"]')?.value, 10) || 1);
    sub.textContent = fmt(this.t.subtotal, { product: this.dataset.productTitle, price: formatMoney(v.price * qty, this.money), tier: c.dataset.dsName, tier_price: formatMoney(Number(c.dataset.dsPrice), this.money) });
    sub.hidden = false;
  }
  onFormData(fd) {
    const c = this.choice; if (!c) return;
    const n = toItems(fd);
    const key = `ds${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const v = this.variants.find((x) => String(x.id) === String(fd.get('items[0][id]'))) || this.variants.find((x) => String(x.id) === String(this.variantId));
    const forText = v && v.title && v.title !== 'Default Title' ? `${this.dataset.productTitle} – ${v.title}` : this.dataset.productTitle;
    fd.append('items[0][properties][_parent_key]', key);
    fd.append('items[0][properties][Design Service]', c.dataset.dsName);
    fd.append('items[0][properties][_design_tier]', c.dataset.dsTier);
    fd.append(`items[${n}][id]`, c.value);
    fd.append(`items[${n}][quantity]`, '1');
    fd.append(`items[${n}][properties][_parent_key]`, key);
    fd.append(`items[${n}][properties][_for]`, forText);
    fd.append(`items[${n}][properties][_parent_url]`, `/products/${this.dataset.productHandle}${v ? `?variant=${v.id}` : ''}`);
    fd.append(`items[${n}][properties][Design tier]`, c.dataset.dsName);
    fd.append(`items[${n}][properties][_design_tier]`, c.dataset.dsTier);
    this.track('design_service_added', { tier: c.dataset.dsTier, product: this.dataset.productHandle });
  }
}
if (!customElements.get('design-service')) customElements.define('design-service', DesignService);
