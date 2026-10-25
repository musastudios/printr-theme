/* PRINTR features — compare, wishlist, recently viewed, load more, layout switch,
   newsletter popup, pickup availability, shipping estimator, sticky buy bar.
   Original code. Loaded as an ES module (deferred). */
const t = (k) => (window.themeStrings && window.themeStrings[k]) || k;
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
const root = (window.routes && window.routes.root) || '/';
const productUrl = (h) => `${root.replace(/\/$/, '')}/products/${encodeURIComponent(h)}`;
const announce = (msg) => {
  let el = document.getElementById('a11y-live');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'a11y-live', className: 'visually-hidden' }); el.setAttribute('aria-live', 'polite'); document.body.append(el); }
  el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; });
};

/* ---------- localStorage-backed handle lists ---------- */
class HandleStore {
  constructor(key, max) { this.key = key; this.max = max; }
  get() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } }
  set(list) {
    try { localStorage.setItem(this.key, JSON.stringify(list.slice(0, this.max))); } catch { /* storage full or blocked */ }
    document.dispatchEvent(new CustomEvent(`${this.key}:change`, { detail: this.get() }));
  }
  has(h) { return this.get().includes(h); }
  toggle(h) { const l = this.get(); this.set(l.includes(h) ? l.filter((x) => x !== h) : [h, ...l]); return this.has(h); }
  remove(h) { this.set(this.get().filter((x) => x !== h)); }
  push(h) { this.set([h, ...this.get().filter((x) => x !== h)]); }
}
export const stores = {
  wishlist: new HandleStore('printr-wishlist', 50),
  compare: new HandleStore('printr-compare', 4),
  recent: new HandleStore('printr-recent', 12)
};

const fetchSection = async (handle, section) => {
  const res = await fetch(`${productUrl(handle)}?section_id=${section}`);
  if (!res.ok) throw new Error(res.status);
  return parse(await res.text()).querySelector(`#shopify-section-${section}`);
};
const cardFor = async (h) => { try { return (await fetchSection(h, 'card-render'))?.querySelector('[data-card-item]'); } catch { return null; } };

/* sync toggle buttons */
const syncToggles = () => {
  for (const [name, store] of [['wishlist', stores.wishlist], ['compare', stores.compare]]) {
    const list = store.get();
    document.querySelectorAll(`[data-${name}-toggle]`).forEach((b) => b.setAttribute('aria-pressed', list.includes(b.getAttribute(`data-${name}-toggle`))));
    document.querySelectorAll(`[data-${name}-count]`).forEach((c) => { c.textContent = list.length; c.hidden = list.length === 0; });
  }
};
document.addEventListener('click', (e) => {
  const w = e.target.closest('[data-wishlist-toggle]');
  if (w) { e.preventDefault(); const on = stores.wishlist.toggle(w.dataset.wishlistToggle); announce(t(on ? 'wishlistAdded' : 'wishlistRemoved')); }
  const c = e.target.closest('[data-compare-toggle]');
  if (c) {
    e.preventDefault();
    const h = c.dataset.compareToggle;
    if (!stores.compare.has(h) && stores.compare.get().length >= 4) { announce(t('compareFull')); return; }
    const on = stores.compare.toggle(h);
    announce(t(on ? 'compareAdded' : 'compareRemoved'));
    if (on) document.querySelector('compare-bar')?.expand();
  }
});
['printr-wishlist:change', 'printr-compare:change'].forEach((ev) => document.addEventListener(ev, syncToggles));
document.addEventListener('shopify:section:load', syncToggles);
new MutationObserver(() => syncToggles()).observe(document.getElementById('MainContent') || document.body, { childList: true, subtree: true });
syncToggles();

/* ---------- product grid filled from a handle list ---------- */
class HandleGrid extends HTMLElement {
  async connectedCallback() {
    this.list = this.querySelector('[data-grid]');
    this.empty = this.querySelector('[data-empty]');
    this.render();
    if (this.dataset.source !== 'recent') document.addEventListener(`printr-${this.dataset.source}:change`, () => this.render());
  }
  async render() {
    let handles = stores[this.dataset.source].get();
    if (this.dataset.exclude) handles = handles.filter((h) => h !== this.dataset.exclude);
    handles = handles.slice(0, Number(this.dataset.limit || 24));
    this.toggleAttribute('data-has-items', handles.length > 0);
    if (this.empty) this.empty.hidden = handles.length > 0;
    if (!handles.length) { this.list.replaceChildren(); return; }
    this.setAttribute('aria-busy', 'true');
    const cards = (await Promise.all(handles.map(cardFor))).filter(Boolean);
    this.list.replaceChildren(...cards.map((c) => { const li = document.createElement('li'); li.append(c); return li; }));
    this.removeAttribute('aria-busy');
    syncToggles();
  }
}
customElements.define('handle-grid', HandleGrid);

/* record recently viewed */
const ph = document.querySelector('[data-product-handle]');
if (ph) stores.recent.push(ph.dataset.productHandle);

/* ---------- compare bar + dialog ---------- */
class CompareBar extends HTMLElement {
  connectedCallback() {
    this.items = this.querySelector('[data-items]');
    this.dialog = this.querySelector('dialog');
    this.table = this.querySelector('[data-table]');
    this.querySelector('[data-open]')?.addEventListener('click', () => this.openTable());
    this.querySelector('[data-clear]')?.addEventListener('click', () => { stores.compare.set([]); announce(t('compareCleared')); });
    this.querySelector('[data-collapse]')?.addEventListener('click', () => this.toggleAttribute('collapsed'));
    this.dialog?.addEventListener('click', (e) => { if (e.target === this.dialog || e.target.closest('[data-close]')) this.dialog.close(); });
    this.addEventListener('click', (e) => { const r = e.target.closest('[data-remove]'); if (r) { stores.compare.remove(r.dataset.remove); if (this.dialog.open) this.openTable(); } });
    document.addEventListener('printr-compare:change', () => this.render());
    this.render();
  }
  expand() { this.removeAttribute('collapsed'); }
  async render() {
    const list = stores.compare.get();
    this.hidden = list.length === 0;
    const cols = await Promise.all(list.map((h) => fetchSection(h, 'compare-column').catch(() => null)));
    this.columns = cols.map((c) => c?.querySelector('[data-compare-column]')).filter(Boolean);
    this.items.replaceChildren(...this.columns.map((col) => {
      const li = document.createElement('li');
      li.className = 'compare-bar__item';
      li.innerHTML = col.querySelector('[data-row="product"]').innerHTML;
      li.insertAdjacentHTML('beforeend', `<button type="button" class="icon-button" data-remove="${col.dataset.handle}" aria-label="${t('remove')}"><svg viewBox="0 0 24 24" width="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`);
      return li;
    }));
    const btn = this.querySelector('[data-open]');
    if (btn) btn.disabled = this.columns.length < 2;
  }
  async openTable() {
    if (!this.columns) await this.render();
    if (!this.columns.length) { this.dialog.close(); return; }
    const labels = JSON.parse(this.dataset.labels || '{}');
    const rows = [];
    this.columns.forEach((col) => col.querySelectorAll('[data-row]').forEach((c) => { if (!rows.find((r) => r.key === c.dataset.row)) rows.push({ key: c.dataset.row, label: c.dataset.label || labels[c.dataset.row] || c.dataset.row }); }));
    const cg = `<colgroup><col class="compare-table__label-col">${this.columns.map(() => '<col class="compare-table__col">').join('')}</colgroup>`;
    const head = `<thead><tr><td class="compare-table__corner"></td>${this.columns.map((c) => `<th scope="col">${c.querySelector('[data-row="product"]').innerHTML}<button type="button" class="link" data-remove="${c.dataset.handle}">${t('remove')}</button></th>`).join('')}</tr></thead>`;
    const body = rows.filter((r) => r.key !== 'product').map((r) => {
      const vals = this.columns.map((c) => c.querySelector(`[data-row="${CSS.escape(r.key)}"]`)?.innerHTML.trim() || '—');
      const differs = new Set(vals).size > 1;
      return `<tr class="${differs ? 'is-diff' : ''}"><th scope="row">${r.label}</th>${vals.map((v) => `<td>${v}</td>`).join('')}</tr>`;
    }).join('');
    this.table.innerHTML = `<table class="compare-table" style="--cols: ${this.columns.length}">${cg}${head}<tbody>${body}</tbody></table>`;
    if (!this.dialog.open) this.dialog.showModal();
  }
}
customElements.define('compare-bar', CompareBar);

/* ---------- collection: layout switch + load more / infinite ---------- */
class LayoutSwitch extends HTMLElement {
  connectedCallback() {
    const grid = document.querySelector(this.dataset.target);
    const saved = localStorage.getItem('printr-layout');
    const apply = (mode) => {
      if (!grid) return;
      grid.dataset.layout = mode;
      this.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.value === mode));
    };
    if (saved) apply(saved);
    this.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; apply(b.value); localStorage.setItem('printr-layout', b.value); });
    document.addEventListener('facets:updated', () => apply(localStorage.getItem('printr-layout') || 'grid'));
  }
}
customElements.define('layout-switch', LayoutSwitch);

class LoadMore extends HTMLElement {
  connectedCallback() {
    this.button = this.querySelector('button');
    this.button?.addEventListener('click', () => this.load());
    if (this.dataset.mode === 'infinite' && this.button && 'IntersectionObserver' in window) {
      this.io = new IntersectionObserver((en) => { if (en[0].isIntersecting) this.load(); }, { rootMargin: '600px' });
      this.io.observe(this);
    }
  }
  disconnectedCallback() { this.io?.disconnect(); }
  async load() {
    if (this.busy || !this.dataset.next) return;
    this.busy = true; this.button.setAttribute('aria-busy', 'true'); this.button.disabled = true;
    try {
      const url = new URL(this.dataset.next, location.origin);
      url.searchParams.set('section_id', this.dataset.section);
      const doc = parse(await (await fetch(url)).text());
      const items = doc.querySelectorAll('[data-product-grid] > li');
      const grid = document.querySelector('[data-product-grid]');
      items.forEach((li) => grid.append(li));
      const nextEl = doc.querySelector('load-more');
      this.querySelector('[data-progress]')?.replaceWith(nextEl?.querySelector('[data-progress]') || '');
      announce(t('moreLoaded').replace('__COUNT__', items.length));
      grid.children[grid.children.length - items.length]?.querySelector('a')?.focus({ preventScroll: true });
      if (nextEl?.dataset.next) { this.dataset.next = nextEl.dataset.next; } else { this.remove(); }
      document.dispatchEvent(new CustomEvent('reveal:scan'));
    } catch { announce(t('error')); } finally {
      this.busy = false; if (this.button) { this.button.removeAttribute('aria-busy'); this.button.disabled = false; }
    }
  }
}
customElements.define('load-more', LoadMore);

/* ---------- newsletter popup (frequency-capped) ---------- */
class NewsletterPopup extends HTMLElement {
  /* Non-modal dialog (show, not showModal) so it stays below drawers (z-index 50 < drawer 60).
     Never opens while the menu/cart/search drawer, header search or a mega menu is open.
     Mobile: home page only, after 20s or 50% scroll. */
  busy() {
    return !!document.querySelector('drawer-panel[open], dialog[open], .mega-open, [data-search-input][aria-expanded="true"], .header__item.has-mega > button[aria-expanded="true"]');
  }
  focusables() {
    return [...this.dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }
  show() {
    this.returnTo = document.activeElement;
    this.dialog.show();
    this.dialog.classList.add('is-open');
    const f = this.focusables();
    (this.dialog.querySelector('input[type=email]') || f[0] || this.dialog).focus();
  }
  hide(persist) {
    if (!this.dialog.open) return;
    this.dialog.classList.remove('is-open');
    this.dialog.close();
    if (persist) localStorage.setItem('printr-popup', Date.now());
    if (this.returnTo && this.returnTo.isConnected && typeof this.returnTo.focus === 'function') this.returnTo.focus();
    this.returnTo = null;
  }
  trap(e) {
    if (e.key !== 'Tab' || !this.dialog.open) return;
    const f = this.focusables();
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !this.dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !this.dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  connectedCallback() {
    this.dialog = this.querySelector('dialog');
    const key = 'printr-popup';
    const days = Number(this.dataset.frequency || 7);
    const last = Number(localStorage.getItem(key) || 0);
    const success = this.dataset.success === 'true';
    const close = () => this.hide(true);
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', (e) => {
      if (!this.dialog.open) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); } else this.trap(e);
    });
    /* A drawer opening over the popup hides it (no frequency write); it comes back later only via a new page view. */
    new MutationObserver(() => { if (this.dialog.open && document.querySelector('drawer-panel[open]')) { this.returnTo = null; this.hide(false); } })
      .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    if (success) { this.show(); localStorage.setItem(key, Date.now() + 3650 * 864e5); return; }
    if (window.Shopify && window.Shopify.designMode) return;
    if (Date.now() - last < days * 864e5) return;
    const mobile = window.matchMedia('(max-width: 749px)').matches;
    if (mobile && this.dataset.home !== 'true') return;
    let done = false;
    const open = () => {
      if (done) return;
      if (this.busy()) { setTimeout(open, 3000); return; }
      done = true; cleanup(); this.show();
    };
    const timer = setTimeout(open, (mobile ? 20 : Number(this.dataset.delay || 8)) * 1000);
    const onLeave = (e) => { if (e.clientY <= 0) open(); };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0 && window.scrollY / max >= 0.5) open();
    };
    const cleanup = () => { clearTimeout(timer); document.removeEventListener('mouseout', onLeave); window.removeEventListener('scroll', onScroll); };
    if (mobile) window.addEventListener('scroll', onScroll, { passive: true });
    else if (this.dataset.exitIntent === 'true') document.addEventListener('mouseout', onLeave);
  }
}
customElements.define('newsletter-popup', NewsletterPopup);

/* ---------- store pickup availability ---------- */
class PickupAvailability extends HTMLElement {
  connectedCallback() {
    this.load(this.dataset.variantId);
    document.addEventListener('variant:change', (e) => this.load(e.detail.variantId));
    this.addEventListener('click', (e) => { if (e.target.closest('[data-pickup-open]')) this.querySelector('dialog')?.showModal(); if (e.target.closest('[data-close]') || e.target.tagName === 'DIALOG') this.querySelector('dialog')?.close(); });
  }
  async load(id) {
    if (!id) return;
    try {
      const res = await fetch(`${root.replace(/\/$/, '')}/variants/${id}/?section_id=pickup-availability`);
      const sec = parse(await res.text()).querySelector('#shopify-section-pickup-availability');
      this.innerHTML = sec ? sec.innerHTML : '';
    } catch { this.innerHTML = ''; }
  }
}
customElements.define('pickup-availability', PickupAvailability);

/* ---------- cart shipping estimator ---------- */
class ShippingEstimator extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    this.out = this.querySelector('[data-results]');
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.estimate(); });
  }
  async estimate() {
    const fd = new FormData(this.form);
    const q = new URLSearchParams();
    ['country', 'province', 'zip'].forEach((k) => q.set(`shipping_address[${k}]`, fd.get(k) || ''));
    const btn = this.form.querySelector('[type=submit]');
    btn.setAttribute('aria-busy', 'true');
    this.out.textContent = t('loading');
    try {
      const base = root.replace(/\/$/, '');
      const prep = await fetch(`${base}/cart/prepare_shipping_rates.json?${q}`, { method: 'POST' });
      if (!prep.ok) throw await prep.json();
      let data = null;
      for (let i = 0; i < 10 && !data; i++) {
        const r = await (await fetch(`${base}/cart/async_shipping_rates.json?${q}`)).json();
        if (r && r.shipping_rates) data = r.shipping_rates; else await new Promise((ok) => setTimeout(ok, 500));
      }
      if (!data || !data.length) { this.out.textContent = t('noRates'); return; }
      const fmt = new Intl.NumberFormat(document.documentElement.lang, { style: 'currency', currency: (window.Shopify && Shopify.currency && Shopify.currency.active) || 'USD' });
      this.out.innerHTML = `<ul role="list">${data.map((r) => `<li><span>${r.name}</span><strong>${Number(r.price) === 0 ? t('free') : fmt.format(r.price)}</strong></li>`).join('')}</ul>`;
    } catch (err) {
      const msg = err && typeof err === 'object' ? Object.entries(err).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('. ') : '';
      this.out.textContent = msg || t('error');
    } finally { btn.removeAttribute('aria-busy'); }
  }
}
customElements.define('shipping-estimator', ShippingEstimator);

/* ---------- sticky buy bar ---------- */
class StickyBuy extends HTMLElement {
  connectedCallback() {
    const target = document.querySelector(this.dataset.watch);
    if (!target || !('IntersectionObserver' in window)) return;
    this.inert = true;
    new IntersectionObserver(([e]) => {
      const on = !e.isIntersecting && e.boundingClientRect.top < 0;
      this.toggleAttribute('visible', on);
      this.inert = !on;
    }).observe(target);
    this.querySelector('button')?.addEventListener('click', () => { target.querySelector('[type=submit]')?.click(); });
  }
}
customElements.define('sticky-buy', StickyBuy);

/* ---------- back to top ---------- */
const btt = document.querySelector('[data-back-to-top]');
if (btt) {
  addEventListener('scroll', () => btt.toggleAttribute('data-show', scrollY > innerHeight * 1.5), { passive: true });
  btt.addEventListener('click', () => { scrollTo({ top: 0 }); document.getElementById('MainContent')?.focus({ preventScroll: true }); });
}

/* Customer address form: country → province select, from Shopify's data-provinces option attributes. */
class AddressForm extends HTMLElement {
  connectedCallback() {
    this.country = this.querySelector('[data-country]');
    this.province = this.querySelector('[data-province]');
    this.wrap = this.querySelector('[data-province-wrap]');
    const def = this.country.dataset.default;
    if (def) [...this.country.options].forEach((o) => { if (o.value === def || o.textContent === def) o.selected = true; });
    this.country.addEventListener('change', () => this.fill());
    this.fill(this.province.dataset.default);
  }
  fill(selected) {
    const opt = this.country.selectedOptions[0];
    let list = [];
    try { list = JSON.parse(opt?.dataset.provinces || '[]'); } catch { list = []; }
    this.wrap.hidden = !list.length;
    this.province.replaceChildren(...list.map(([value, label]) => new Option(label, value, false, value === selected)));
  }
}
customElements.get('address-form') || customElements.define('address-form', AddressForm);

document.addEventListener('submit', (e) => {
  const msg = e.target.dataset?.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});
