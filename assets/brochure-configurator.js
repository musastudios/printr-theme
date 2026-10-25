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
    /** @param {{config?: object, url?: string, variants: Array<{id:number, options:string[], price:number, available:boolean}>, optionNames: string[]}} o */
    constructor(o) { this.o = o; this.config = o.config || null; this.variants = o.variants || []; this.names = (o.optionNames || []).map((n) => String(n).toLowerCase()); }
    async load() { if (!this.config && this.o.url) this.config = await (await fetch(this.o.url)).json(); return this; }
    getSchema() { return this.config; }
    getRules() { return this.config.rules || []; }
    resolveVariant(sel) {
      const m = this.config.options_map || { size: 'Size', qty: 'Qty', config: 'Config' };
      const want = { [m.size.toLowerCase()]: sel.size, [m.qty.toLowerCase()]: String(sel.qty), [m.config.toLowerCase()]: configCode(this.config, sel) };
      const v = this.variants.find((x) => this.names.every((n, i) => want[n] === undefined || String(x.options[i]) === String(want[n])));
      return v ? { id: v.id, available: v.available !== false, price: v.price } : null;
    }
    getPrice(sel) {
      const v = this.resolveVariant(sel);
      if (v && v.price != null) return { price: v.price / 100, source: 'variant', variant: v };
      const row = (this.config.prices || {})[`${sel.size}|${configCode(this.config, sel)}`] || {};
      const t = row[String(sel.qty)];
      return t && t.p != null ? { price: t.p, source: t.src || 'real', variant: v } : { price: null, source: 'quote', variant: v };
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
      const product = json('[data-bc-product]') || { variants: [], options: [] };
      this.lang = (this.dataset.lang || document.documentElement.lang || 'en').slice(0, 2) === 'es' ? 'es' : 'en';
      this.money = (n) => new Intl.NumberFormat(this.dataset.locale || undefined, { style: 'currency', currency: this.dataset.currency || 'USD' }).format(n);
      this.adapter = new StaticJsonAdapter({ config: json('[data-bc-config]'), url: this.dataset.configUrl, variants: product.variants, optionNames: product.options });
      try { await this.adapter.load(); } catch (e) { this.querySelector('[data-bc-steps]').textContent = this.t.error || 'Error'; return; }
      this.schema = this.adapter.getSchema(product);
      this.engine = createEngine(this.schema, this.adapter.getRules());
      this.sel = this.engine.resolve({}).sel;
      this.addEventListener('change', (e) => {
        if (e.target.matches('[data-bc-proof]')) { const qa = this.uploaderQa(); if (qa) { qa.checked = e.target.checked; qa.dispatchEvent(new Event('change', { bubbles: true })); } this.apply(); return; }
        if (e.target.matches('[data-bc-sample]')) { this.apply(); return; }
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
      this.renderTiers();
      const note = this.querySelector('[data-bc-note]');
      const names = reset.map((k) => { const g = this.schema.groups.find((x) => x.key === k); return g ? this.label(g) : this.t.quantity; });
      note.textContent = names.length ? (this.t.reset || '').replace('{{ options }}', names.join(', ')) : '';
      note.hidden = !names.length;
      if (focusKey) this.querySelector(`select[data-bc-key="${focusKey}"], [data-bc-key="${focusKey}"]:checked`)?.focus({ preventScroll: true });
      this.apply();
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
          <span class="bc-run__tot">${p.price != null ? this.money(p.price) : `<em class="bc-quote-tag">${esc(this.t.quote_short)}</em>`}</span>
        </label>`;
      }).join('');
    }
    /** Push the selection into the product form: variant id, line-item properties, event for the artwork uploader. */
    apply() {
      const form = this.form; const sel = this.sel;
      const p = this.adapter.getPrice(sel); const v = p.variant;
      const sellable = !!(v && v.available && p.price != null);
      const spec = { ...sel, config: configCode(this.schema, sel), turnaround: this.schema.turnaround && this.schema.turnaround.v };
      const props = {};
      this.schema.groups.forEach((g) => { const x = g.values.find((y) => y.v === sel[g.key]); props[this.label(g)] = this.valueLabel(g, x); });
      props[this.t.quantity] = String(sel.qty);
      if (this.schema.turnaround) props[this.t.turnaround] = this.L(this.schema.turnaround.label);
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
      const quote = this.querySelector('[data-bc-quote]');
      quote.hidden = sellable;
      if (!sellable) {
        const base = this.dataset.quoteUrl || '/pages/contact';
        const msg = Object.entries(props).filter(([k]) => k !== '_spec').map(([k, val]) => `${k}: ${val}`).join('\n');
        quote.querySelector('a').href = `${base}${base.includes('?') ? '&' : '?'}subject=${encodeURIComponent(this.t.quote_subject || 'Quote')}&body=${encodeURIComponent(msg)}`;
      }
      this.dataset.state = sellable ? 'ready' : 'quote';
      if (v && v.id !== this.lastId) { this.lastId = v.id; document.dispatchEvent(new CustomEvent('variant:change', { detail: { variantId: v.id, sectionId: this.dataset.section, source: 'brochure-configurator', spec } })); }
      this.dispatchEvent(new CustomEvent('brochure:change', { bubbles: true, detail: { selection: sel, spec, price: p, variant: v } }));
    }
  }
  root.customElements.define('brochure-configurator', BrochureConfigurator);
})(typeof window !== 'undefined' ? window : globalThis);
