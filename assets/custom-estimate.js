/* PRINTR · Get a Custom Estimate modal.
 * Prefills the product + the options selected on the page, lets the customer adjust them,
 * and posts a Turnstile-verified request to the Growth Engine (/api/quote-request).
 * Vanilla custom element; native <dialog> + explicit focus trap. */
const fmt = (s, vars = {}) => String(s || '').replace(/\[(\w+)\]/g, (_, k) => (k in vars ? vars[k] : `[${k}]`));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

const track = (name, detail = {}) => {
  try { window.Shopify?.analytics?.publish?.(name, detail); } catch (e) { /* noop */ }
  document.dispatchEvent(new CustomEvent(`printr:${name}`, { detail }));
};

let turnstileLoader;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { turnstileLoader = null; reject(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return turnstileLoader;
}

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

class CustomEstimate extends HTMLElement {
  connectedCallback() {
    if (this._ready) return;
    this._ready = true;
    try { this.product = JSON.parse(this.querySelector('[data-cq-product]')?.textContent || '{}'); } catch (e) { this.product = {}; }
    try { this.t = JSON.parse(this.querySelector('[data-cq-i18n]')?.textContent || '{}'); } catch (e) { this.t = {}; }
    this.dialog = this.querySelector('[data-cq-dialog]');
    this.panel = this.querySelector('[data-cq-panel]');
    this.form = this.querySelector('[data-cq-form]');
    this.alert = this.querySelector('[data-cq-alert]');
    this.submitBtn = this.querySelector('[data-cq-submit]');
    this.success = this.querySelector('[data-cq-success]');
    this.qtyIndex = Number(this.dataset.qtyIndex ?? -1);
    this.token = '';
    this.widgetId = null;
    this.turnstileFailed = false;
    this.lastVariant = null;
    this.done = false;

    // Move the dialog to <body> so section re-renders and transforms on ancestors never clip it.
    document.body.appendChild(this.dialog);
    this.dialog.classList.add('cq');

    this.querySelector('[data-cq-open]').addEventListener('click', (e) => this.open(e.currentTarget));
    this.dialog.querySelectorAll('[data-cq-close]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.dialog.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.close(); });
    this.dialog.addEventListener('keydown', (e) => this.trap(e));
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
    this.form.addEventListener('input', (e) => this.onInput(e));
    this.form.addEventListener('change', (e) => this.onChange(e));
    this.dialog.querySelector('[data-cq-copy]')?.addEventListener('click', () => this.copyRef());

    const date = this.field('neededBy');
    if (date) {
      const min = new Date();
      min.setDate(min.getDate() + 1);
      const max = new Date();
      max.setFullYear(max.getFullYear() + 2);
      date.min = isoDate(min);
      date.max = isoDate(max);
    }
    this.updateCount();
  }

  disconnectedCallback() {
    // Section re-renders (theme editor) create a fresh element; drop the orphaned dialog.
    if (this.dialog && !this.isConnected) {
      if (this.dialog.open) this.dialog.close();
      document.documentElement.classList.remove('cq-lock');
      this.dialog.remove();
    }
  }

  field(name) { return this.form.querySelector(`[data-cq-field="${name}"]`); }

  /* ---------- prefill ---------- */
  currentVariantId() {
    const sectionForm = document.getElementById(`ProductForm-${this.dataset.section}`);
    const fromForm = sectionForm?.querySelector('[name="id"]')?.value;
    if (fromForm) return Number(fromForm);
    const fromUrl = new URL(window.location.href).searchParams.get('variant');
    if (fromUrl) return Number(fromUrl);
    const fromSection = this.closest('[data-selected-variant]')?.dataset.selectedVariant;
    return Number(fromSection || this.product.selected || 0);
  }

  prefill() {
    const id = this.currentVariantId();
    const variant = (this.product.variants || []).find((v) => Number(v.id) === id);
    this.variant = variant || null;
    if (id && id === this.lastVariant) return;
    this.lastVariant = id;
    if (variant) {
      this.form.querySelectorAll('[data-cq-option]').forEach((wrap) => {
        const i = Number(wrap.dataset.cqOption);
        const select = wrap.querySelector('select');
        const val = variant.options?.[i];
        if (select && val != null && [...select.options].some((o) => o.value === val)) {
          select.value = val;
          this.toggleCustom(wrap, false);
        }
      });
    }
    const qty = this.field('quantity');
    if (qty) {
      let q = '';
      if (variant && this.qtyIndex >= 0) q = variant.options?.[this.qtyIndex] || '';
      if (!q) {
        const lineQty = document.getElementById(`Qty-${this.dataset.section}`)?.value;
        q = lineQty && lineQty !== '1' ? lineQty : (this.qtyIndex >= 0 ? '' : '1');
      }
      qty.value = q;
    }
    const rush = document.querySelector(`#shopify-section-${this.dataset.section} [data-rush-opt]:checked, .product [data-rush-opt]:checked`);
    if (rush && rush.value && rush.value !== 'standard') {
      const r = this.form.querySelector('input[name="turnaround"][value="rush"]');
      if (r) r.checked = true;
    }
  }

  /* ---------- open / close ---------- */
  open(opener) {
    if (this.dialog.open) return;
    this.opener = opener || document.activeElement;
    if (this.done) this.resetForm();
    this.prefill();
    document.documentElement.classList.add('cq-lock');
    this.dialog.classList.remove('is-closing');
    this.dialog.showModal();
    track('custom_estimate_open', { handle: this.product.handle, variant: this.variant?.id || null });
    requestAnimationFrame(() => {
      const first = this.done ? this.success : (this.form.querySelector('[data-cq-option-select], [data-cq-field="quantity"]') || this.field('name'));
      first?.focus({ preventScroll: true });
    });
    if (this.dataset.sitekey && !this.widgetId) this.initTurnstile();
  }

  close() {
    if (!this.dialog.open || this.closing) return;
    const finish = () => {
      this.closing = false;
      this.dialog.classList.remove('is-closing');
      this.dialog.close();
      document.documentElement.classList.remove('cq-lock');
      this.opener?.focus?.({ preventScroll: true });
    };
    if (reduced()) return finish();
    this.closing = true;
    this.dialog.classList.add('is-closing');
    setTimeout(finish, 210);
  }

  trap(e) {
    if (e.key !== 'Tab') return;
    const items = [...this.panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !this.panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- interactions ---------- */
  toggleCustom(wrap, show) {
    const box = wrap.querySelector('[data-cq-custom]');
    if (!box) return;
    box.hidden = !show;
    const input = box.querySelector('input');
    if (show) requestAnimationFrame(() => input?.focus());
    else { input.value = ''; this.setError(input, ''); }
  }

  onChange(e) {
    const el = e.target;
    if (el.matches('[data-cq-option-select]')) this.toggleCustom(el.closest('[data-cq-option]'), el.value === '__custom');
    if (el.name === 'contactPreference') {
      const needsPhone = el.value !== 'email';
      const opt = this.form.querySelector('[data-cq-phone-opt]');
      if (opt) opt.hidden = needsPhone;
      this.field('phone').required = needsPhone;
    }
  }

  onInput(e) {
    const el = e.target;
    if (el.getAttribute('aria-invalid') === 'true') this.setError(el, '');
    if (el === this.field('notes')) this.updateCount();
  }

  updateCount() {
    const notes = this.field('notes');
    const out = this.form.querySelector('[data-cq-count]');
    if (!notes || !out) return;
    const left = 3000 - notes.value.length;
    out.textContent = left < 600 ? fmt(this.t.chars_left, { count: left }) : '';
  }

  setError(el, msg) {
    if (!el) return;
    const wrap = el.closest('.cq__field');
    const err = wrap?.querySelector('[data-cq-err]');
    if (msg) {
      el.setAttribute('aria-invalid', 'true');
      if (err) { err.textContent = msg; err.hidden = false; }
    } else {
      el.removeAttribute('aria-invalid');
      if (err) { err.textContent = ''; err.hidden = true; }
    }
  }

  showAlert(msg) {
    this.alert.textContent = msg;
    this.alert.hidden = !msg;
  }

  /* ---------- Turnstile ---------- */
  async initTurnstile() {
    const host = this.dialog.querySelector('[data-cq-turnstile]');
    if (!host) return;
    try {
      await loadTurnstile();
      this.widgetId = window.turnstile.render(host, {
        sitekey: this.dataset.sitekey,
        theme: 'light',
        size: 'flexible',
        language: (this.dataset.locale || 'es').slice(0, 2),
        action: 'quote_request',
        callback: (token) => { this.token = token; this.turnstileFailed = false; if (this.alert.textContent === this.t.turnstile_required) this.showAlert(''); },
        'expired-callback': () => { this.token = ''; },
        'error-callback': () => { this.token = ''; this.turnstileFailed = true; }
      });
    } catch (e) {
      this.turnstileFailed = true;
    }
  }

  resetTurnstile() {
    this.token = '';
    try { if (this.widgetId != null) window.turnstile?.reset(this.widgetId); } catch (e) { /* noop */ }
  }

  /* ---------- submit ---------- */
  collect() {
    const options = [];
    this.form.querySelectorAll('[data-cq-option]').forEach((wrap) => {
      const select = wrap.querySelector('select');
      const custom = select.value === '__custom';
      const value = custom ? wrap.querySelector('[data-cq-custom-input]').value.trim() : select.value;
      options.push({ name: select.dataset.name, value, custom });
    });
    const val = (n) => (this.field(n)?.value || '').trim();
    const radio = (n) => this.form.querySelector(`input[name="${n}"]:checked`)?.value || '';
    return {
      name: val('name'),
      email: val('email'),
      phone: val('phone'),
      company: val('company'),
      contactPreference: radio('contactPreference') || 'email',
      locale: this.dataset.locale || document.documentElement.lang || 'es',
      product: {
        handle: this.product.handle,
        title: this.product.title,
        variantId: this.variant ? String(this.variant.id) : '',
        variantTitle: this.variant?.title || ''
      },
      options,
      quantity: val('quantity'),
      turnaround: radio('turnaround'),
      neededBy: val('neededBy'),
      notes: val('notes'),
      marketingOptIn: !!this.form.querySelector('[data-cq-optin]')?.checked,
      loggedIn: this.dataset.loggedIn === 'true',
      pageUrl: window.location.href,
      website: this.form.querySelector('input[name="website"]')?.value || '',
      turnstileToken: this.token
    };
  }

  validate(data) {
    let first = null;
    const fail = (el, msg) => { this.setError(el, msg); if (!first) first = el; };
    this.form.querySelectorAll('[data-cq-option]').forEach((wrap) => {
      const select = wrap.querySelector('select');
      const input = wrap.querySelector('[data-cq-custom-input]');
      if (select.value === '__custom' && !input.value.trim()) fail(input, this.t.custom_value);
    });
    if (!data.quantity) fail(this.field('quantity'), this.t.required);
    const today = this.field('neededBy')?.min || '';
    if (data.neededBy && today && data.neededBy < today) fail(this.field('neededBy'), this.t.date_past);
    if (data.neededBy && this.field('neededBy').max && data.neededBy > this.field('neededBy').max) fail(this.field('neededBy'), this.t.date_far);
    if (data.name.length < 2) fail(this.field('name'), this.t.required);
    if (!EMAIL_RE.test(data.email)) fail(this.field('email'), this.t.email);
    const digits = data.phone.replace(/\D/g, '').length;
    if (data.contactPreference !== 'email' && !data.phone) fail(this.field('phone'), this.t.phone_required);
    else if (data.phone && (digits < 7 || digits > 15)) fail(this.field('phone'), this.t.phone);
    return first;
  }

  applyServerErrors(fields = {}) {
    const map = { name: 'name', email: 'email', phone: 'phone', quantity: 'quantity', neededBy: 'neededBy' };
    let first = null;
    for (const [key, code] of Object.entries(fields)) {
      const el = map[key] && this.field(map[key]);
      if (!el) continue;
      const msg = key === 'email' ? this.t.email : key === 'phone' ? (code === 'required' ? this.t.phone_required : this.t.phone) : key === 'neededBy' ? (code === 'too_far' ? this.t.date_far : this.t.date_past) : this.t.required;
      this.setError(el, msg);
      if (!first) first = el;
    }
    return first;
  }

  async submit() {
    if (this.busy) return;
    this.showAlert('');
    const data = this.collect();
    const invalid = this.validate(data);
    if (invalid) {
      this.showAlert(this.t.fix_fields);
      invalid.focus();
      invalid.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
      return;
    }
    if (!this.dataset.sitekey) { this.showAlert(this.t.turnstile_missing); return; }
    if (!this.token) {
      this.showAlert(this.turnstileFailed ? this.t.turnstile_failed : this.t.turnstile_required);
      this.dialog.querySelector('[data-cq-turnstile]')?.scrollIntoView({ block: 'center' });
      return;
    }
    this.busy = true;
    this.submitBtn.setAttribute('aria-busy', 'true');
    this.submitBtn.textContent = this.t.sending;
    try {
      const res = await fetch(this.dataset.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data)
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        this.showSuccess(json.ref, data.email, json.confirmationSent !== false);
        track('custom_estimate_submit', { handle: data.product.handle, ref: json.ref });
        return;
      }
      if (json.error === 'validation_failed') {
        const first = this.applyServerErrors(json.fields);
        this.showAlert(json.fields?.turnstile ? this.t.turnstile_required : this.t.fix_fields);
        first?.focus();
      } else if (json.error === 'turnstile_failed') this.showAlert(this.t.turnstile_failed);
      else if (json.error === 'rate_limited') this.showAlert(this.t.rate_limited);
      else this.showAlert(this.t.generic);
    } catch (e) {
      this.showAlert(this.t.generic);
    } finally {
      this.busy = false;
      this.submitBtn.removeAttribute('aria-busy');
      this.submitBtn.textContent = this.t.submit;
      this.resetTurnstile();
    }
  }

  showSuccess(ref, email, confirmed) {
    this.done = true;
    this.dialog.querySelector('[data-cq-ref]').textContent = ref || '';
    const sent = this.dialog.querySelector('[data-cq-sent]');
    sent.textContent = confirmed ? fmt(this.t.sent_to, { email }) : this.t.no_confirmation;
    this.form.hidden = true;
    this.dialog.querySelector('[data-cq-foot]').hidden = true;
    this.dialog.querySelector('[data-cq-done]').hidden = false;
    this.dialog.querySelector('[data-cq-prefill-note]')?.setAttribute('hidden', '');
    this.success.hidden = false;
    this.dialog.querySelector('[data-cq-body]').scrollTop = 0;
    this.success.focus();
  }

  resetForm() {
    this.done = false;
    const keep = ['name', 'email', 'phone', 'company'].map((n) => [n, this.field(n)?.value]);
    this.form.reset();
    keep.forEach(([n, v]) => { if (this.field(n)) this.field(n).value = v || ''; });
    this.form.querySelectorAll('[data-cq-option]').forEach((wrap) => this.toggleCustom(wrap, false));
    this.form.querySelectorAll('[aria-invalid]').forEach((el) => this.setError(el, ''));
    this.lastVariant = null;
    this.form.hidden = false;
    this.success.hidden = true;
    this.dialog.querySelector('[data-cq-foot]').hidden = false;
    this.dialog.querySelector('[data-cq-done]').hidden = true;
    this.dialog.querySelector('[data-cq-prefill-note]')?.removeAttribute('hidden');
    this.showAlert('');
    this.updateCount();
  }

  async copyRef() {
    const btn = this.dialog.querySelector('[data-cq-copy]');
    const ref = this.dialog.querySelector('[data-cq-ref]').textContent;
    try {
      await navigator.clipboard.writeText(ref);
      btn.textContent = this.t.copied;
      setTimeout(() => { btn.textContent = this.t.copy; }, 1800);
    } catch (e) { /* clipboard blocked */ }
  }
}

if (!customElements.get('custom-estimate')) customElements.define('custom-estimate', CustomEstimate);
