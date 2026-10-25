/* PRINTR brochure configurator: options engine, data adapters and <brochure-configurator> element. No dependencies. */
(function (root) {
  'use strict';
  const inList = (list, v) => (list || []).some((x) => String(x) === String(v));
  const matches = (when, sel) => Object.entries(when || {}).every(([k, vals]) => sel[k] !== undefined && inList(vals, sel[k]));

  /**
   * Options engine. Groups are chosen in order (schema.groups, then qty last).
   * A rule { when, excludes | only, reason } disables values of a LATER group given EARLIER choices.
   */
  function createEngine(schema, rules) {
    const groups = schema.groups.concat([{ key: 'qty', values: schema.qty.map((q) => ({ v: String(q) })) }]);
    const order = groups.map((g) => g.key);
    const active = (rules || []).filter((r) => r.enabled !== false);
    function status(key, v, sel) {
      const gi = order.indexOf(key); const prior = {};
      order.slice(0, gi).forEach((k) => { if (sel[k] !== undefined) prior[k] = sel[k]; });
      for (const r of active) {
        if (!matches(r.when, prior)) continue;
        if (r.only && r.only[key] && !inList(r.only[key], v)) return { ok: false, rule: r };
        if (r.excludes && r.excludes[key] && inList(r.excludes[key], v)) return { ok: false, rule: r };
      }
      return { ok: true };
    }
    /** Walk groups in order; keep valid choices, replace invalid ones with the first valid value. Returns the keys that were reset. */
    function resolve(sel) {
      const out = {}; const reset = [];
      for (const g of groups) {
        let v = sel[g.key];
        if (v === undefined || !status(g.key, v, out).ok) {
          const nv = [g.default].concat(g.values.map((x) => x.v)).filter((x) => x !== undefined).find((x) => status(g.key, x, out).ok);
          if (v !== undefined && nv !== v) reset.push(g.key);
          v = nv;
        }
        out[g.key] = v;
      }
      return { sel: out, reset };
    }
    return { groups, order, status, resolve };
  }

  const configCode = (schema, sel) => (schema.config_code || []).map((k) => sel[k]).join('-');

  /**
   * Data adapter interface (all methods may return a value or a Promise):
   *   getSchema(product) -> { groups, qty, options_map, config_code, title }
   *   getRules()         -> [{ id, when, excludes|only, reason: {en, es}, enabled }]
   *   getPrice(sel)      -> { price: Number|null (store currency), source: 'variant'|'real'|'placeholder'|'quote' }
   *   resolveVariant(sel)-> { id, available, price } | null
   */
  class StaticJsonAdapter {
    /**
     * Variants are never shipped in bulk (Liquid product.variants caps at 250). Each Size/Config pair's Qty variants
     * come from product_option_value.variant, loaded with the Section Rendering API and ?option_values=.
     * Price and availability always come from the variant.
     * @param {{config?: object, url?: string, product: {options: string[], qty: string, values: object}, initial?: object, fetchUrl: string, sectionId: string}} o
     */
    constructor(o) { this.o = o; this.config = o.config || null; this.product = o.product || { options: [], values: {} }; this.cache = new Map(); this.pending = new Map(); this.add(o.initial); }
    async load() { if (!this.config && this.o.url) this.config = await (await fetch(this.o.url)).json(); return this; }
    getSchema() { return this.config; }
    getRules() { return this.config.rules || []; }
    want(sel) { const m = this.config.options_map || { size: 'Size', qty: 'Qty', config: 'Config' }; const code = configCode(this.config, sel); const codes = this.product.codes || {}; return { [m.size]: sel.size, [m.qty]: String(sel.qty), [m.config]: Object.prototype.hasOwnProperty.call(codes, code) ? codes[code] : code }; }
    key(sel) { const w = this.want(sel); return this.product.options.filter((n) => n !== this.product.qty).map((n) => `${w[n]}|`).join(''); }
    add(d) { if (d && d.key != null) this.cache.set(d.key, new Map((d.tiers || []).filter((t) => t.id).map((t) => [String(t.qty), t]))); }
    has(sel) { return this.cache.has(this.key(sel)); }
    /** Load the Qty variants for this selection's Size/Config. Resolves to false when the combination has no option values. */
    ensure(sel) {
      const k = this.key(sel); if (this.cache.has(k)) return Promise.resolve(true);
      if (this.pending.has(k)) return this.pending.get(k);
      const w = this.want(sel); const vals = this.product.values || {};
      const ids = this.product.options.map((n) => (vals[n] || {})[w[n]] ?? (n === this.product.qty ? Object.values(vals[n] || {})[0] : undefined));
      if (ids.some((x) => x == null)) { this.cache.set(k, new Map()); return Promise.resolve(false); }
      const u = new URL(this.o.fetchUrl, location.href); u.searchParams.set('section_id', this.o.sectionId); u.searchParams.set('option_values', ids.join(','));
      const job = fetch(u).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((html) => {
        const el = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-bc-variants]');
        const d = el ? JSON.parse(el.textContent) : null;
        if (d && d.key === k) this.add(d); else this.cache.set(k, new Map());
        return true;
      }).catch(() => false).finally(() => this.pending.delete(k));
      this.pending.set(k, job); return job;
    }
    resolveVariant(sel) {
      const row = this.cache.get(this.key(sel)); const v = row && row.get(String(sel.qty));
      return v ? { id: v.id, available: v.available !== false, price: v.price, options: v.options } : null;
    }
    getPrice(sel) {
      if (!this.has(sel)) return { price: null, source: 'loading', variant: null };
      const v = this.resolveVariant(sel);
      // A $0.00 variant is unpriced: quote it rather than sell it for free.
      return v && v.price > 0 ? { price: v.price / 100, source: 'variant', variant: v } : { price: null, source: 'quote', variant: v };
    }
  }

  /**
   * Stub for a future live connector (pricing API or on-demand Worker). Same interface, so the UI does not change.
   * Expected endpoints (proposal, see docs/brochure-configurator.md):
   *   GET  {base}/schema?product=brochures      -> schema JSON (same shape as StaticJsonAdapter config)
   *   GET  {base}/rules?product=brochures       -> rules array
   *   POST {base}/price   { selection }         -> { price, source }
   *   POST {base}/variant { selection }         -> { id, available, price } (Worker creates the variant on demand)
   */
  class SupplierApiAdapter {
    constructor(o) { this.base = o && o.base; this.cache = new Map(); }
    async load() { throw new Error('SupplierApiAdapter is not implemented yet'); }
    getSchema() { throw new Error('not implemented'); }
    getRules() { throw new Error('not implemented'); }
    getPrice() { throw new Error('not implemented'); }
    resolveVariant() { throw new Error('not implemented'); }
  }

  root.PrintrConfigurator = { createEngine, configCode, StaticJsonAdapter, SupplierApiAdapter };

  if (!root.customElements || root.customElements.get('brochure-configurator')) return;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  class BrochureConfigurator extends HTMLElement {
    async connectedCallback() {
      const json = (s) => { const el = this.querySelector(s); try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; } };
      this.t = json('[data-bc-strings]') || {};
      const product = json('[data-bc-product]') || { options: [], values: {} };
      this.lang = (this.dataset.lang || document.documentElement.lang || 'en').slice(0, 2) === 'es' ? 'es' : 'en';
      this.money = (n) => new Intl.NumberFormat(this.dataset.locale || undefined, { style: 'currency', currency: this.dataset.currency || 'USD' }).format(n);
      this.adapter = new StaticJsonAdapter({ config: json('[data-bc-config]'), url: this.dataset.configUrl, product, initial: json('[data-bc-variants]'), fetchUrl: this.dataset.productUrl || location.pathname, sectionId: this.dataset.section });
      try { await this.adapter.load(); } catch (e) { this.querySelector('[data-bc-steps]').textContent = this.t.error || 'Error'; return; }
      this.schema = this.adapter.getSchema(product);
      this.engine = createEngine(this.schema, this.adapter.getRules());
      this.sel = this.engine.resolve({}).sel;
      const tl = this.schema.turnarounds; this.turn = tl && tl.length ? (tl.find((x) => x.default) || tl[0]).v : null;
      this.addEventListener('change', (e) => {
        if (e.target.matches('[data-bc-proof]')) { const qa = this.uploaderQa(); if (qa) { qa.checked = e.target.checked; qa.dispatchEvent(new Event('change', { bubbles: true })); } this.apply(); return; }
        if (e.target.matches('[data-bc-sample], [data-bc-addon]')) { this.apply(); return; }
        if (e.target.matches('[data-bc-turn-opt]')) { this.turn = e.target.value; this.apply(); return; }
        const r = e.target.closest('[data-bc-key]'); if (!r) return;
        this.choose(r.dataset.bcKey, r.value);
      });
      document.addEventListener('change', (e) => { if (e.target.matches('[data-au-qa]')) this.syncProof(); });
      // Add-on lines (job sample, and the QA fee when the artwork uploader isn't handling it) go to the cart with the item.
      this.form?.addEventListener('submit', () => this.addExtras(), true);
      this.render([]);
    }
    /** Digital proof = the $5 Pre-flight & QA add-on. Delegates to the artwork uploader's QA checkbox when it has one. */
    uploaderQa() { const qa = document.querySelector('[data-au-qa]'); return qa && !qa.disabled && qa.closest('[data-au-qa-row]') && !qa.closest('[hidden]') ? qa : null; }
    syncProof() { const qa = this.uploaderQa(); const box = this.querySelector('[data-bc-proof]'); if (qa && box) { box.checked = qa.checked; this.apply(); } }
    extras() { return { sample: !!this.querySelector('[data-bc-sample]')?.checked, proof: !!this.querySelector('[data-bc-proof]')?.checked }; }
    addExtras() {
      const ex = this.extras(); const items = [];
      if (ex.sample && this.dataset.sampleVariant) items.push({ id: Number(this.dataset.sampleVariant), quantity: 1 });
      if (ex.proof && this.dataset.qaVariant && !this.uploaderQa()) items.push({ id: Number(this.dataset.qaVariant), quantity: 1 });
      if (!items.length || this.dataset.state !== 'ready') return;
      fetch(`${(root.Shopify && root.Shopify.routes && root.Shopify.routes.root) || '/'}cart/add.js`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items }) }).catch(() => {});
    }
    /** Optional add-ons (type 'option') shown only when their `when` matches the selection; recorded as line properties. */
    addons() { return (this.schema.addons || []).filter((a) => a.type === 'option' && matches(a.when, this.sel)); }
    turnaround() { const tl = this.schema.turnarounds; return tl && tl.length ? tl.find((x) => x.v === this.turn) || tl[0] : this.schema.turnaround; }
    renderExtras() {
      const uid = this.dataset.section || 'bc'; const tl = this.schema.turnarounds; const tbox = this.querySelector('[data-bc-turn]');
      if (tl && tl.length && tbox) tbox.innerHTML = tl.map((x) => `<label class="bc-turn"><input type="radio" name="bc-${uid}-turn" value="${esc(x.v)}" data-bc-turn-opt ${x.v === this.turn ? 'checked' : ''}><span>${esc(this.L(x.label))}</span></label>`).join(' ');
      const abox = this.querySelector('[data-bc-addons]'); if (!abox) return;
      const on = new Set([...abox.querySelectorAll('[data-bc-addon]:checked')].map((i) => i.value)); const list = this.addons();
      abox.innerHTML = list.length ? `<h3 class="bc-sec__title bc-sec__title--sm">${esc(this.t.options || '')}</h3>` + list.map((a) => `<label class="bc-check"><input type="checkbox" data-bc-addon value="${esc(a.key)}" ${on.has(a.key) ? 'checked' : ''}><span>${esc(this.L(a.label))}</span></label>`).join('') : '';
      abox.hidden = !list.length;
    }
    L(o) { return o && typeof o === 'object' ? (o[this.lang] || o.en) : o; }
    get form() { return document.getElementById(this.dataset.formId); }
    choose(key, v) {
      const next = { ...this.sel, [key]: v };
      const i = this.engine.order.indexOf(key);
      const { sel, reset } = this.engine.resolve(next);
      this.sel = sel;
      this.render(reset.filter((k) => this.engine.order.indexOf(k) > i), key);
    }
    valueLabel(g, x) { const o = this.t.values && this.t.values[g.key]; return (x && o && o[x.v]) || this.L(x && x.label); }
    label(g) { return (this.t.labels && this.t.labels[g.key]) || this.L(g.label); }
    render(reset, focusKey) {
      const steps = this.querySelector('[data-bc-steps]');
      const uid = this.dataset.section || 'bc';
      steps.innerHTML = this.schema.groups.map((g) => {
        const opts = g.values.map((x) => {
          const st = this.engine.status(g.key, x.v, this.sel);
          const why = st.ok ? '' : ` (${this.L(st.rule.reason)})`;
          return `<option value="${esc(x.v)}" ${this.sel[g.key] === x.v ? 'selected' : ''} ${st.ok ? '' : 'disabled'}>${esc(this.valueLabel(g, x))}${esc(why)}</option>`;
        }).join('');
        const id = `bc-${uid}-${g.key}`;
        return `<div class="bc-field${g.key === 'fold' ? ' bc-field--full' : ''}"><label class="bc-field__label" for="${id}">${esc(this.label(g))}<span class="bc-req" aria-hidden="true">*</span></label>
          <div class="bc-select"><select id="${id}" data-bc-key="${g.key}" required>${opts}</select><span class="bc-select__ic" aria-hidden="true">${this.icon('chevron')}</span></div></div>`;
      }).join('');
      this.load();
      this.renderTiers();
      this.renderExtras();
      const note = this.querySelector('[data-bc-note]');
      const names = reset.map((k) => { const g = this.schema.groups.find((x) => x.key === k); return g ? this.label(g) : this.t.quantity; });
      note.textContent = names.length ? (this.t.reset || '').replace('__OPTS__', names.join(', ')) : '';
      note.hidden = !names.length;
      if (focusKey) this.querySelector(`select[data-bc-key="${focusKey}"], [data-bc-key="${focusKey}"]:checked`)?.focus({ preventScroll: true });
      this.apply();
    }
    /** Fetch the selected Size/Config's variants if not loaded yet, then refresh prices and the form. */
    load() {
      const sel = this.sel; if (this.adapter.has(sel)) { this.fixQty(); return; }
      this.adapter.ensure(sel).then(() => { if (this.sel === sel) { this.fixQty(); this.renderTiers(); this.apply(); } });
    }
    /** Cascade to real variants: keep the run size when it is sellable, else move to the first run size that is (or the only one left). */
    fixQty() {
      const okQ = this.schema.qty.map(String).filter((q) => this.engine.status('qty', q, this.sel).ok && (this.adapter.resolveVariant({ ...this.sel, qty: q }) || {}).available);
      if (!okQ.length || okQ.includes(String(this.sel.qty))) return;
      this.sel = { ...this.sel, qty: okQ[0] };
    }
    icon(n) { const t = this.querySelector(`template[data-bc-icon="${n}"]`); return t ? t.innerHTML : ''; }
    renderTiers() {
      const box = this.querySelector('[data-bc-tiers]'); const uid = this.dataset.section || 'bc';
      box.innerHTML = this.schema.qty.map((q) => {
        const sel = { ...this.sel, qty: String(q) };
        const ok = this.engine.status('qty', String(q), this.sel).ok;
        const p = this.adapter.getPrice(sel);
        const unit = p.price != null ? p.price / q : null;
        return `<label class="bc-run__row${ok ? '' : ' is-disabled'}">
          <input type="radio" name="bc-${uid}-qty" value="${q}" data-bc-key="qty" ${String(this.sel.qty) === String(q) ? 'checked' : ''} ${ok ? '' : 'disabled'}>
          <span class="bc-run__qty">${q.toLocaleString(this.dataset.locale || undefined)}</span>
          <span class="bc-run__unit">${unit != null ? this.money(unit) : '—'}</span>
          <span class="bc-run__tot">${p.price != null ? this.money(p.price) : p.source === 'loading' ? '…' : `<em class="bc-quote-tag">${esc(this.t.quote_short)}</em>`}</span>
        </label>`;
      }).join('');
    }
    /** Push the selection into the product form: variant id, line-item properties, event for the artwork uploader. */
    apply() {
      const form = this.form; const sel = this.sel;
      const p = this.adapter.getPrice(sel); const v = p.variant;
      const sellable = !!(v && v.available && p.price != null);
      const spec = { ...sel, config: configCode(this.schema, sel), turnaround: this.turnaround() && this.turnaround().v };
      const props = {};
      this.schema.groups.forEach((g) => { const x = g.values.find((y) => y.v === sel[g.key]); props[this.label(g)] = this.valueLabel(g, x); });
      props[this.t.quantity] = String(sel.qty);
      if (this.turnaround()) props[this.t.turnaround] = this.L(this.turnaround().label);
      const picked = this.querySelectorAll('[data-bc-addon]:checked'); const addons = [];
      picked.forEach((i) => { const a = this.addons().find((x) => x.key === i.value); if (a) { props[this.L(a.label)] = this.t.yes; addons.push(a.key); } });
      if (addons.length) spec.addons = addons;
      const ex = this.extras();
      if (ex.sample) props[this.t.sample] = this.dataset.sampleVariant ? this.t.yes : `${this.t.yes} (+$9.99 ${this.t.invoiced})`;
      if (ex.proof) props[this.t.proof] = this.dataset.qaVariant || this.uploaderQa() ? this.t.yes : `${this.t.yes} (+$5.00 ${this.t.invoiced})`;
      props._spec = JSON.stringify(spec);
      const holder = this.querySelector('[data-bc-props]');
      holder.innerHTML = Object.entries(props).map(([k, val]) => `<input type="hidden" form="${esc(this.dataset.formId)}" name="properties[${esc(k)}]" value="${esc(val)}"${sellable ? '' : ' disabled'}>`).join('');
      if (form) {
        const id = form.querySelector('input[name="id"]'); if (id) id.value = sellable ? v.id : '';
        form.querySelectorAll('[type="submit"], [data-buy-now]').forEach((b) => { if (!sellable) b.setAttribute('data-bc-blocked', ''); else b.removeAttribute('data-bc-blocked'); b.disabled = !sellable; });
      }
      const sum = this.querySelector('[data-bc-summary]');
      sum.innerHTML = p.price != null ? `<span>${esc(this.t.total)}</span> <strong>${this.money(p.price)}</strong>` : '';
      const loading = p.source === 'loading';
      const quote = this.querySelector('[data-bc-quote]');
      quote.hidden = sellable || loading;
      if (!sellable && !loading) {
        const base = this.dataset.quoteUrl || '/pages/contact';
        const msg = Object.entries(props).filter(([k]) => k !== '_spec').map(([k, val]) => `${k}: ${val}`).join('\n');
        quote.querySelector('a').href = `${base}${base.includes('?') ? '&' : '?'}subject=${encodeURIComponent(this.t.quote_subject || 'Quote')}&body=${encodeURIComponent(msg)}`;
      }
      this.dataset.state = sellable ? 'ready' : loading ? 'loading' : 'quote';
      if (v && v.id !== this.lastId) { this.lastId = v.id; document.dispatchEvent(new CustomEvent('variant:change', { detail: { variantId: v.id, sectionId: this.dataset.section, source: 'brochure-configurator', spec, options: v.options } })); }
      this.dispatchEvent(new CustomEvent('brochure:change', { bubbles: true, detail: { selection: sel, spec, price: p, variant: v } }));
    }
  }
  root.customElements.define('brochure-configurator', BrochureConfigurator);
})(typeof window !== 'undefined' ? window : globalThis);
