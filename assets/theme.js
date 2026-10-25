// PRINTR theme — vanilla web components (original code)
const fetchSections = async (url, opts = {}) => {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(res.statusText);
  return res;
};
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

/* Reveal on scroll */
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
}, { rootMargin: '0px 0px -10% 0px' }) : null;
const observeReveal = (root = document) => root.querySelectorAll('[data-reveal]:not(.is-visible)').forEach((el) => io ? io.observe(el) : el.classList.add('is-visible'));
observeReveal();
document.addEventListener('shopify:section:load', (e) => observeReveal(e.target));
document.addEventListener('reveal:scan', () => observeReveal());

/* Drawer: <drawer-panel id> + [aria-controls] toggles */
class DrawerPanel extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', (e) => { if (e.target.closest('[data-drawer-close]')) this.close(); });
    this.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }
  open(trigger) {
    this.trigger = trigger || document.activeElement;
    this.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
    this.trigger?.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => this.querySelector('[data-autofocus], button, a, input')?.focus());
  }
  close() {
    this.removeAttribute('open');
    document.body.style.overflow = '';
    this.trigger?.setAttribute('aria-expanded', 'false');
    this.trigger?.focus();
  }
}
customElements.define('drawer-panel', DrawerPanel);
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-drawer-open]');
  if (!t) return;
  const d = document.getElementById(t.dataset.drawerOpen);
  if (d) { e.preventDefault(); d.open(t); }
});

/* Quantity input */
class QuantityInput extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector('input');
    this.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const step = Number(this.input.step) || 1;
      const min = Number(this.input.min) || 0;
      const v = Number(this.input.value) + (b.name === 'plus' ? step : -step);
      this.input.value = Math.max(min, v);
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }));
  }
}
customElements.define('quantity-input', QuantityInput);

/* Cart: drawer + page share <cart-items> */
const CART_SECTIONS = ['cart-drawer'];
const renderCartSections = (sections) => {
  if (!sections) return;
  Object.entries(sections).forEach(([id, html]) => {
    if (!html) return;
    const doc = parse(html);
    const fresh = doc.querySelector(`#shopify-section-${id}`) || doc.body.firstElementChild;
    const current = document.getElementById(`shopify-section-${id}`);
    if (fresh && current) current.innerHTML = fresh.innerHTML;
  });
};
const refreshCount = async () => {
  try {
    const cart = await (await fetch(`${window.routes.cart_url}.js`)).json();
    document.querySelectorAll('[data-cart-count]').forEach((el) => { el.textContent = cart.item_count; el.hidden = cart.item_count === 0; });
  } catch (e) { /* noop */ }
};
const sectionIdsOnPage = () => {
  const ids = [...CART_SECTIONS];
  document.querySelectorAll('cart-items[data-section]').forEach((c) => ids.push(c.dataset.section));
  return [...new Set(ids)].filter((id) => document.getElementById(`shopify-section-${id}`));
};
class CartItems extends HTMLElement {
  connectedCallback() {
    this.addEventListener('change', (e) => {
      if (e.target.matches('[data-line-qty]')) this.update(e.target.dataset.line, e.target.value);
      if (e.target.matches('[name="note"]')) fetch(`${window.routes.cart_url}/update.js`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: e.target.value }) });
    });
    this.addEventListener('click', (e) => {
      const r = e.target.closest('[data-line-remove]');
      if (r) { e.preventDefault(); this.update(r.dataset.lineRemove, 0); }
    });
  }
  async update(line, quantity) {
    this.setAttribute('aria-busy', 'true');
    try {
      const res = await fetchSections(`${window.routes.cart_change_url}.js`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ line: Number(line), quantity: Number(quantity), sections: sectionIdsOnPage() })
      });
      const data = await res.json();
      renderCartSections(data.sections); refreshCount();
      await removeOrphanFees(data);
    } catch (err) { console.error(err); } finally { this.removeAttribute('aria-busy'); }
  }
}
customElements.define('cart-items', CartItems);

/* Linked add-on lines follow their parent; orphans are removed.
 * - Artwork QA fee: child has _artwork_fee, linked by _artwork_link.
 * - Design Service: child has "Design tier", linked by _parent_key. */
const isDesignChild = (i) => i.properties && i.properties._parent_key && i.properties['Design tier'];
const isFeeChild = (i) => i.properties && i.properties._artwork_fee;
let feeCheck = null;
async function removeOrphanFees(cart) {
  if (feeCheck) return feeCheck;
  feeCheck = (async () => {
    try {
      const c = cart && cart.items ? cart : await (await fetch(`${window.routes.cart_url}.js`)).json();
      const parents = new Set(c.items.filter((i) => i.properties && i.properties._artwork_link && !isFeeChild(i)).map((i) => i.properties._artwork_link));
      const dsParents = new Set(c.items.filter((i) => i.properties && i.properties._parent_key && !isDesignChild(i)).map((i) => i.properties._parent_key));
      const updates = {};
      c.items.forEach((i) => {
        if (isFeeChild(i) && !parents.has(i.properties._artwork_link)) updates[i.key] = 0;
        else if (isDesignChild(i) && !dsParents.has(i.properties._parent_key)) updates[i.key] = 0;
        else if (isDesignChild(i) && i.quantity !== 1) updates[i.key] = 1; // design line is always qty 1
      });
      if (!Object.keys(updates).length) return;
      const res = await fetch(`${window.routes.cart_url}/update.js`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ updates, sections: sectionIdsOnPage() }) });
      const data = await res.json();
      renderCartSections(data.sections); refreshCount();
    } catch (err) { console.error(err); } finally { feeCheck = null; }
  })();
  return feeCheck;
}
if (document.querySelector('cart-items') || document.getElementById('CartDrawer')) removeOrphanFees();

/* Product form: AJAX add to cart, opens drawer */
class ProductForm extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    this.form?.addEventListener('submit', (e) => this.submit(e));
  }
  async submit(e) {
    if (document.body.dataset.cartType === 'page') return;
    e.preventDefault();
    const btn = this.form.querySelector('[type="submit"]');
    const err = this.querySelector('[data-form-error]');
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    let fd = new FormData(this.form);
    fd.append('sections', sectionIdsOnPage().join(','));
    fd.append('sections_url', window.location.pathname);
    const post = (body) => fetch(`${window.routes.cart_add_url}.js`, { method: 'POST', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body });
    try {
      let res = await post(fd);
      let data = await res.json();
      // Design Service add failed: keep the print item, drop the design line + its markers, and flag the selector.
      if (data.status && [...fd.keys()].some((k) => k.endsWith('[properties][Design tier]'))) {
        const retry = withoutDesign(fd);
        res = await post(retry); data = await res.json();
        if (!data.status) document.dispatchEvent(new CustomEvent('design:add-failed', { detail: { formId: this.form.id } }));
      }
      if (data.status) { if (err) { err.textContent = data.description || data.message; err.hidden = false; } return; }
      if (err) err.hidden = true;
      renderCartSections(data.sections); refreshCount();
      document.querySelector('quick-view-modal[open]')?.close();
      document.getElementById('CartDrawer')?.open(btn);
    } catch (x) { if (err) { err.textContent = window.themeStrings.error; err.hidden = false; } }
    finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
  }
}
customElements.define('product-form', ProductForm);

/** Copy an items[] FormData without the Design Service line and its parent markers. */
function withoutDesign(fd) {
  const drop = new Set();
  for (const [k] of fd.entries()) { const m = k.match(/^items\[(\d+)\]\[properties\]\[Design tier\]$/); if (m) drop.add(m[1]); }
  const out = new FormData(); const map = {}; let next = 0;
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^items\[(\d+)\](.*)$/);
    if (!m) { out.append(k, v); continue; }
    if (drop.has(m[1])) continue;
    if (m[1] === '0' && /\[properties\]\[(_parent_key|_design_tier|Design Service)\]$/.test(m[2])) continue;
    if (!(m[1] in map)) map[m[1]] = next++;
    out.append(`items[${map[m[1]]}]${m[2]}`, v);
  }
  return out;
}

/* Variant picker: re-renders the product section via Section Rendering API */
class VariantPicker extends HTMLElement {
  connectedCallback() {
    this.addEventListener('change', (e) => this.onChange(e));
  }
  async onChange() {
    const selected = [...this.querySelectorAll('input:checked, select')].map((el) => el.dataset.optionValueId || el.selectedOptions?.[0]?.dataset.optionValueId).filter(Boolean);
    const sectionId = this.dataset.section;
    const focusedId = document.activeElement?.dataset?.optionValueId;
    const url = `${this.dataset.url}?option_values=${selected.join(',')}&section_id=${sectionId}`;
    const root = document.getElementById(`shopify-section-${sectionId}`) || this.closest('.qv');
    root?.setAttribute('aria-busy', 'true');
    try {
      const html = await (await fetchSections(url)).text();
      const doc = parse(html);
      const variantId = doc.querySelector('[data-selected-variant]')?.dataset.selectedVariant;
      ['[data-swap="price"]', '[data-swap="tiers"]', '[data-swap="buy"]', '[data-swap="picker"]', '[data-swap="media"]', '[data-swap="sku"]'].forEach((sel) => {
        const a = root.querySelector(sel); const b = doc.querySelector(sel);
        if (a && b) a.replaceWith(b);
      });
      if (variantId && this.dataset.updateUrl !== 'false') {
        const u = new URL(window.location.href); u.searchParams.set('variant', variantId);
        window.history.replaceState({}, '', u);
      }
      if (focusedId) root.querySelector(`[data-option-value-id="${focusedId}"]`)?.focus();
      if (variantId) document.dispatchEvent(new CustomEvent('variant:change', { detail: { variantId, sectionId } }));
    } catch (err) { console.error(err); } finally { root?.removeAttribute('aria-busy'); }
  }
}
customElements.define('variant-picker', VariantPicker);

/* Tier table: clicking a tier selects that quantity option */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tier-select]');
  if (!b) return;
  const input = document.querySelector(`[data-option-value-id="${b.dataset.tierSelect}"]`);
  if (input) {
    if (input.tagName === 'OPTION') { input.selected = true; input.closest('select').dispatchEvent(new Event('change', { bubbles: true })); }
    else { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }
  }
});

/* Tier table (radio rows): choosing a row selects that quantity option, which swaps the variant used by Add to cart */
document.addEventListener('change', (e) => {
  const r = e.target.closest?.('[data-tier-radio]');
  if (!r || !r.checked) return;
  const valueId = r.dataset.tierRadio;
  const input = document.querySelector(`variant-picker [data-option-value-id="${valueId}"]`) || document.querySelector(`[data-option-value-id="${valueId}"]`);
  if (!input) return;
  if (input.tagName === 'OPTION') { input.selected = true; input.closest('select').dispatchEvent(new Event('change', { bubbles: true })); }
  else { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }
  // The tier table is re-rendered after the variant swap; return focus to the chosen row.
  document.addEventListener('variant:change', () => document.querySelector(`[data-tier-radio="${valueId}"]`)?.focus({ preventScroll: true }), { once: true });
});

/* Predictive search */
class PredictiveSearch extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector('input[type="search"]');
    this.results = this.querySelector('[data-results]');
    let t;
    this.input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search(), 250); });
    this.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }
  async search() {
    const q = this.input.value.trim();
    if (q.length < 2) return this.close();
    const url = `${window.routes.predictive_search_url}?q=${encodeURIComponent(q)}&section_id=predictive-search&resources[limit]=6`;
    try {
      const html = await (await fetchSections(url)).text();
      const inner = parse(html).querySelector('#shopify-section-predictive-search');
      this.results.innerHTML = inner ? inner.innerHTML : '';
      this.results.hidden = false;
      this.input.setAttribute('aria-expanded', 'true');
    } catch (e) { this.close(); }
  }
  close() { this.results.hidden = true; this.input.setAttribute('aria-expanded', 'false'); }
}
customElements.define('predictive-search', PredictiveSearch);

/* Slideshow lives in assets/slideshow.js (Swiper) and loads only with the hero slider section. */

/* Countdown timer */
class CountdownTimer extends HTMLElement {
  connectedCallback() {
    this.end = new Date(this.dataset.end).getTime();
    if (Number.isNaN(this.end)) return;
    this.tick(); this.timer = setInterval(() => this.tick(), 1000);
  }
  disconnectedCallback() { clearInterval(this.timer); }
  tick() {
    let s = Math.max(0, Math.floor((this.end - Date.now()) / 1000));
    const parts = { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
    Object.entries(parts).forEach(([k, v]) => { const el = this.querySelector(`[data-${k}]`); if (el) el.textContent = String(v).padStart(2, '0'); });
    if (s === 0) clearInterval(this.timer);
  }
}
customElements.define('countdown-timer', CountdownTimer);

/* Tabs */
class TabsComponent extends HTMLElement {
  connectedCallback() {
    this.tabs = [...this.querySelectorAll('[role="tab"]')];
    this.tabs.forEach((t, i) => {
      t.addEventListener('click', () => this.select(i));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { this.select((i + 1) % this.tabs.length, true); }
        if (e.key === 'ArrowLeft') { this.select((i - 1 + this.tabs.length) % this.tabs.length, true); }
      });
    });
  }
  select(i, focus) {
    this.tabs.forEach((t, j) => {
      const on = i === j; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) this.tabs[i].focus();
  }
}
customElements.define('tabs-component', TabsComponent);

/* Facets: AJAX filtering for collection & search */
class FacetForm extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    let t;
    this.form.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.render(), 400); });
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.render(); });
  }
  async render() {
    const params = new URLSearchParams(new FormData(this.form));
    for (const [k, v] of [...params.entries()]) if (v === '') params.delete(k);
    const sectionId = this.dataset.section;
    const root = document.getElementById(`shopify-section-${sectionId}`);
    root.setAttribute('aria-busy', 'true');
    try {
      const html = await (await fetchSections(`${window.location.pathname}?${params}&section_id=${sectionId}`)).text();
      const fresh = parse(html).querySelector('[data-results-grid]');
      root.querySelector('[data-results-grid]').replaceWith(fresh);
      observeReveal(root);
      document.dispatchEvent(new CustomEvent('facets:updated'));
      history.replaceState({}, '', `${window.location.pathname}?${params}`);
    } finally { root.removeAttribute('aria-busy'); }
  }
}
customElements.define('facet-form', FacetForm);

/* Quick view: loads product with the quick-view section */
class QuickViewModal extends HTMLElement {
  connectedCallback() {
    this.dialog = this.querySelector('dialog');
    this.body = this.querySelector('[data-body]');
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog || e.target.closest('[data-close]')) this.close(); });
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-quick-view]');
      if (t) { e.preventDefault(); this.open(t.dataset.quickView); }
    });
  }
  async open(url) {
    this.body.innerHTML = `<p>${window.themeStrings.loading || '…'}</p>`;
    this.dialog.showModal(); this.setAttribute('open', '');
    const html = await (await fetchSections(`${url}${url.includes('?') ? '&' : '?'}section_id=quick-view-content`)).text();
    const inner = parse(html).querySelector('#shopify-section-quick-view-content');
    this.body.innerHTML = inner ? inner.innerHTML : '';
  }
  close() { this.dialog.close(); this.removeAttribute('open'); }
}
customElements.define('quick-view-modal', QuickViewModal);

/* Native scroll-snap carousel: prev/next buttons that scroll by one slide, state reflected via aria-disabled. */
class CarouselTrack extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-track]');
    this.prev = this.querySelector('[data-prev]');
    this.next = this.querySelector('[data-next]');
    if (!this.track) return;
    const step = (dir) => {
      const slide = this.track.querySelector('.carousel__slide');
      const gap = parseFloat(getComputedStyle(this.track).columnGap) || 0;
      const w = slide ? slide.getBoundingClientRect().width + gap : this.track.clientWidth;
      const rtl = getComputedStyle(this).direction === 'rtl' ? -1 : 1;
      this.track.scrollBy({ left: dir * w * rtl, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    this.prev?.addEventListener('click', () => step(-1));
    this.next?.addEventListener('click', () => step(1));
    this.update = () => {
      const max = this.track.scrollWidth - this.track.clientWidth - 2;
      const x = Math.abs(this.track.scrollLeft);
      this.prev?.setAttribute('aria-disabled', x <= 2);
      this.next?.setAttribute('aria-disabled', x >= max);
      this.toggleAttribute('static', max <= 0);
    };
    this.track.addEventListener('scroll', this.update, { passive: true });
    new ResizeObserver(this.update).observe(this.track);
    this.update();
  }
}
customElements.get('carousel-track') || customElements.define('carousel-track', CarouselTrack);

