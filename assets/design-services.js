/* PrinterShop Design Services page: compare slider + 4-step quote request.
 * Vanilla custom elements. No GSAP. No invented prices or turnaround promises. */
const fmt = (s, vars = {}) => String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`)).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

const track = (name, payload = {}) => {
  try { window.Shopify?.analytics?.publish?.(name, payload); } catch (e) { /* noop */ }
  document.dispatchEvent(new CustomEvent(name.replace(/_/g, ':'), { detail: payload }));
};

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const PRODUCT_RULES = [
  { re: /door-?hanger|tear-off-door/i, id: 'door-hangers' },
  { re: /business-?card/i, id: 'business-cards' },
  { re: /letterhead|envelope|second-?sheet/i, id: 'letterhead-envelopes' },
  { re: /sticker|label|bumper/i, id: 'stickers-labels' },
  { re: /banner|\bsigns?\b|poster/i, id: 'banners-signs' },
  { re: /apparel|t-?shirt|hoodie|polo|\bhat\b|\bcap\b|tote/i, id: 'apparel' },
  { re: /postcard|flyer|brochure|flat-flyer/i, id: 'postcards-flyers' }
];

const mapProduct = (handle) => {
  if (!handle) return null;
  const h = String(handle);
  for (const rule of PRODUCT_RULES) if (rule.re.test(h)) return rule.id;
  return null;
};

const markImageFallback = (root) => {
  root.querySelectorAll('img.dsp-compare__img').forEach((img) => {
    const fail = () => {
      img.hidden = true;
      img.closest('.dsp-compare__layer')?.classList.add('is-empty');
    };
    img.addEventListener('error', fail);
    if (img.complete && img.naturalWidth === 0) fail();
  });
};

class DsCompare extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector('input[type="range"]');
    this.toggles = this.querySelectorAll('[data-ds-pos]');
    this.valuetext = this.dataset.valuetext || 'Showing {after} percent of the after design';
    const start = Number(this.dataset.value || this.input?.value || 38);
    this.set(start, false);
    this.onInput = () => this.set(this.input.value, true);
    this.input?.addEventListener('input', this.onInput);
    this.input?.addEventListener('change', this.onInput);
    this.toggles.forEach((btn) => {
      btn.addEventListener('click', () => this.set(btn.dataset.dsPos, true));
    });
    markImageFallback(this);
  }
  disconnectedCallback() {
    this.input?.removeEventListener('input', this.onInput);
    this.input?.removeEventListener('change', this.onInput);
  }
  set(value, _user) {
    const n = Math.max(0, Math.min(100, Number(value)));
    this.style.setProperty('--pos', `${n}%`);
    this.dataset.value = String(n);
    if (this.input && Number(this.input.value) !== n) this.input.value = String(n);
    const after = 100 - n;
    this.input?.setAttribute('aria-valuetext', fmt(this.valuetext, { after, before: n }));
    this.toggles.forEach((btn) => {
      const target = Number(btn.dataset.dsPos);
      const pressed = (target === 100 && n >= 95) || (target === 0 && n <= 5);
      btn.setAttribute('aria-pressed', String(pressed));
    });
  }
}

class DsShowcase extends HTMLElement {
  connectedCallback() {
    this.tabs = [...this.querySelectorAll('[data-ds-case]')];
    this.panels = [...this.querySelectorAll('[data-ds-panel]')];
    this.live = this.querySelector('[data-ds-live]');
    this.tabs.forEach((tab) => tab.addEventListener('click', () => this.show(tab.dataset.dsCase, true)));
    this.tabs.forEach((tab) => tab.addEventListener('keydown', (e) => this.onKey(e)));
    const initial = this.tabs.find((t) => t.getAttribute('aria-selected') === 'true') || this.tabs[0];
    if (initial) this.show(initial.dataset.dsCase, false);
  }
  onKey(e) {
    const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = this.tabs.indexOf(e.currentTarget);
    const next = this.tabs[(i + keys[e.key] + this.tabs.length) % this.tabs.length];
    next.focus();
    this.show(next.dataset.dsCase, true);
  }
  show(id, user) {
    this.tabs.forEach((tab) => {
      const on = tab.dataset.dsCase === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    this.panels.forEach((panel) => {
      const on = panel.dataset.dsPanel === id;
      panel.hidden = !on;
      if (on) {
        const compare = panel.querySelector('ds-compare');
        if (compare?.set) compare.set(compare.dataset.value || 38, false);
      }
    });
    const tab = this.tabs.find((t) => t.dataset.dsCase === id);
    const name = tab?.textContent?.trim();
    if (this.live && name) this.live.textContent = fmt(this.dataset.live || '{name}', { name });
    if (user) track('design_services_case_view', { case: id });
  }
}

class DsRequest extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    if (!this.form) return;
    this.t = JSON.parse(this.querySelector('[data-ds-strings]')?.textContent || '{}');
    this.total = 4;
    this.step = 1;
    this.token = '';
    this.widgetId = null;
    this.turnstileReady = false;
    this.turnstileFailed = false;
    this.sitekey = this.dataset.sitekey || '';
    this.endpoint = this.dataset.endpoint || '';
    this.summary = this.querySelector('[data-ds-summary]');
    this.status = this.querySelector('[data-ds-step-status]');
    this.errorBox = this.querySelector('[data-ds-error]');
    this.success = this.querySelector('[data-ds-success]');
    this.successText = this.querySelector('[data-ds-success-text]');
    this.submitBtn = this.querySelector('[data-ds-submit]');
    this.nextBtn = this.querySelector('[data-ds-next]');
    this.backBtn = this.querySelector('[data-ds-back]');
    this.querySelector('[data-ds-next]')?.addEventListener('click', () => this.go(this.step + 1));
    this.querySelector('[data-ds-back]')?.addEventListener('click', () => this.go(this.step - 1));
    this.form.addEventListener('submit', (e) => this.onSubmit(e));
    this.form.addEventListener('change', () => { this.syncExclusive(); this.renderSummary(); this.clearFieldErrors(); });
    this.form.addEventListener('input', () => this.renderSummary());
    this.preselectProduct();
    this.onHash = () => this.maybeOpenFromHash(false);
    window.addEventListener('hashchange', this.onHash);
    this.querySelectorAll('[data-ds-jump]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const to = a.getAttribute('href');
        if (to === '#start-request' || to === '#quote') {
          e.preventDefault();
          this.focusRequest();
          track('design_services_cta_click', { from: a.dataset.dsJump || 'link' });
        }
      });
    });
    // CTAs elsewhere on the page (hero / closing band)
    document.querySelectorAll('a[href="#start-request"], a[href="#quote"]').forEach((a) => {
      if (a.closest('ds-request')) return;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.focusRequest();
        track('design_services_cta_click', { from: a.dataset.dsJump || 'cta' });
      });
    });
    this.classList.add('is-enhanced');
    this.go(1, false);
    this.maybeOpenFromHash(true);
    if (this.sitekey) this.initTurnstile();
  }
  disconnectedCallback() {
    window.removeEventListener('hashchange', this.onHash);
  }
  preselectProduct() {
    const handle = new URLSearchParams(location.search).get('product');
    if (!handle) return;
    const hidden = this.form.querySelector('[name="contact[product_handle]"]');
    if (hidden) hidden.value = handle;
    const id = mapProduct(handle);
    if (!id) return;
    const box = this.form.querySelector(`[name="products"][value="${id}"]`);
    if (box) {
      box.checked = true;
      this.syncExclusive();
    }
  }
  maybeOpenFromHash(onLoad) {
    const hash = location.hash;
    if (hash !== '#start-request' && hash !== '#quote') return;
    if (hash === '#quote') {
      history.replaceState(null, '', `${location.pathname}${location.search}#start-request`);
    }
    this.focusRequest(onLoad && reduced());
  }
  focusRequest(instant) {
    const target = document.getElementById('start-request') || this;
    target.scrollIntoView({ behavior: instant ? 'auto' : (reduced() ? 'auto' : 'smooth'), block: 'start' });
    const heading = this.querySelector('[data-ds-step-heading]');
    window.setTimeout(() => heading?.focus(), instant ? 0 : 300);
  }
  steps() { return [...this.querySelectorAll('[data-ds-step]')]; }
  go(n, announce = true) {
    const next = Math.max(1, Math.min(this.total, n));
    if (next > this.step && !this.validate(this.step)) return;
    this.step = next;
    this.steps().forEach((el) => {
      const on = Number(el.dataset.dsStep) === this.step;
      el.hidden = !on;
      el.classList.toggle('is-active', on);
    });
    this.querySelectorAll('[data-ds-tick]').forEach((tick) => {
      const i = Number(tick.dataset.dsTick);
      tick.classList.toggle('is-done', i < this.step);
      tick.classList.toggle('is-current', i === this.step);
      tick.setAttribute('aria-current', i === this.step ? 'step' : 'false');
    });
    if (this.backBtn) this.backBtn.hidden = this.step === 1;
    if (this.nextBtn) this.nextBtn.hidden = this.step === this.total;
    if (this.submitBtn) this.submitBtn.hidden = this.step !== this.total;
    this.renderSummary();
    this.clearError();
    const label = this.t[`step_${this.step}`] || '';
    const heading = this.querySelector('[data-ds-step-heading]');
    if (heading) heading.textContent = label;
    if (this.status) this.status.textContent = fmt(this.t.step_of || 'Step {current} of {total}', { current: this.step, total: this.total }) + (label ? `: ${label}` : '');
    if (announce) {
      this.querySelector('[data-ds-step-heading]')?.focus();
      track('design_services_step_view', { step: this.step });
    }
    if (this.step === 4 && this.sitekey) this.initTurnstile();
  }
  syncExclusive() {
    const unsure = this.form.querySelector('[name="products"][value="unsure"]');
    if (!unsure) return;
    const others = [...this.form.querySelectorAll('[name="products"]:not([value="unsure"])')];
    if (unsure.checked && unsure === document.activeElement) others.forEach((el) => { el.checked = false; });
    else if (others.some((el) => el.checked)) unsure.checked = false;
  }
  selectedNeed() {
    return this.form.querySelector('[name="need"]:checked');
  }
  selectedProducts() {
    return [...this.form.querySelectorAll('[name="products"]:checked')];
  }
  selectedTimeline() {
    return this.form.querySelector('[name="timeline"]:checked');
  }
  renderSummary() {
    if (!this.summary) return;
    const parts = [];
    const need = this.selectedNeed();
    if (need) parts.push(need.dataset.label || need.value);
    const products = this.selectedProducts().map((el) => el.dataset.label || el.value);
    if (products.length) parts.push(products.join(', '));
    const time = this.selectedTimeline();
    if (time) parts.push(time.dataset.label || time.value);
    this.summary.textContent = parts.length ? parts.join(' · ') : (this.t.summary_empty || '');
  }
  fieldError(input, message) {
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    const id = input.id ? `${input.id}-error` : '';
    let err = id && this.querySelector(`#${id}`);
    if (!err) {
      err = document.createElement('p');
      err.className = 'form-error dsp-field-error';
      err.id = id || '';
      err.setAttribute('role', 'alert');
      (input.closest('.field, .dsp-need, .dsp-pills, .dsp-times, fieldset') || input).append(err);
    }
    err.textContent = message;
    if (id) {
      const described = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
      described.add(id);
      input.setAttribute('aria-describedby', [...described].join(' '));
    }
  }
  clearFieldErrors() {
    this.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
    this.querySelectorAll('.dsp-field-error').forEach((el) => el.remove());
  }
  clearError() {
    if (this.errorBox) { this.errorBox.hidden = true; this.errorBox.textContent = ''; }
  }
  showError(message) {
    if (!this.errorBox) return;
    this.errorBox.hidden = false;
    this.errorBox.textContent = message;
  }
  validate(step) {
    this.clearFieldErrors();
    this.clearError();
    let first = null;
    const fail = (input, message) => {
      this.fieldError(input, message);
      if (!first) first = input;
    };
    if (step === 1) {
      const need = this.selectedNeed();
      if (!need) fail(this.form.querySelector('[name="need"]'), this.t.error_need);
    }
    if (step === 2) {
      if (!this.selectedProducts().length) fail(this.form.querySelector('[name="products"]'), this.t.error_products);
    }
    if (step === 3) {
      const brief = this.form.querySelector('[name="contact[body]"]');
      if (!brief?.value.trim()) fail(brief, this.t.error_brief);
      const link = this.form.querySelector('[name="contact[artwork_link]"]');
      const raw = link?.value.trim();
      if (raw) {
        try {
          const u = new URL(raw);
          if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
        } catch (e) {
          fail(link, this.t.error_link);
        }
      }
      if (!this.selectedTimeline()) fail(this.form.querySelector('[name="timeline"]'), this.t.error_timeline);
    }
    if (step === 4) {
      const name = this.form.querySelector('[name="contact[name]"]');
      const email = this.form.querySelector('[name="contact[email]"]');
      if (!name?.value.trim()) fail(name, this.t.error_name);
      if (!email?.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) fail(email, this.t.error_email);
      if (!this.sitekey || this.turnstileFailed) {
        this.showError(this.sitekey ? this.t.turnstile_failed : this.t.turnstile_missing);
        if (!first) first = this.querySelector('[data-ds-turnstile]') || this.submitBtn;
      } else if (!this.token) {
        this.showError(this.t.turnstile_required);
        if (!first) first = this.querySelector('[data-ds-turnstile]') || this.submitBtn;
      }
    }
    if (first) {
      first.focus?.();
      return false;
    }
    return true;
  }
  payload() {
    const email = this.form.querySelector('[name="contact[email]"]')?.value.trim() || '';
    const name = this.form.querySelector('[name="contact[name]"]')?.value.trim() || '';
    const brief = this.form.querySelector('[name="contact[body]"]')?.value.trim() || '';
    const need = this.selectedNeed();
    const products = this.selectedProducts();
    const timeline = this.selectedTimeline();
    return {
      name,
      email,
      phone: this.form.querySelector('[name="contact[phone]"]')?.value.trim() || '',
      business: this.form.querySelector('[name="contact[business]"]')?.value.trim() || '',
      need: need?.value || '',
      needLabel: need?.dataset.label || '',
      products: products.map((el) => el.value),
      productLabels: products.map((el) => el.dataset.label || el.value),
      timeline: timeline?.value || '',
      timelineLabel: timeline?.dataset.label || '',
      brief,
      artwork_link: this.form.querySelector('[name="contact[artwork_link]"]')?.value.trim() || '',
      product_handle: this.form.querySelector('[name="contact[product_handle]"]')?.value || '',
      source: 'design-services'
    };
  }
  composeBody(data) {
    const lines = [
      'Design Services request',
      `Need: ${data.needLabel || data.need}`,
      `Product(s): ${data.productLabels.join(', ')}`,
      `Timeline: ${data.timelineLabel || data.timeline}`,
      data.business ? `Business: ${data.business}` : '',
      data.artwork_link ? `Artwork link: ${data.artwork_link}` : '',
      data.product_handle ? `Product handle: ${data.product_handle}` : '',
      '',
      'Brief:',
      data.brief
    ];
    return lines.filter((line, i) => line !== '' || i > 6).join('\n');
  }
  async initTurnstile() {
    const host = this.querySelector('[data-ds-turnstile]');
    if (!host || !this.sitekey || this.widgetId != null) return;
    try {
      await loadTurnstile();
      this.widgetId = window.turnstile.render(host, {
        sitekey: this.sitekey,
        theme: 'light',
        callback: (token) => { this.token = token; this.turnstileReady = true; this.clearError(); },
        'expired-callback': () => { this.token = ''; },
        'error-callback': () => { this.token = ''; this.turnstileFailed = true; this.showError(this.t.turnstile_failed); }
      });
      this.turnstileFailed = false;
    } catch (e) {
      this.turnstileFailed = true;
      this.showError(this.t.turnstile_failed);
    }
  }
  async onSubmit(e) {
    if (!this.validate(4)) {
      e.preventDefault();
      return;
    }
    const data = this.payload();
    const composed = this.composeBody(data);
    const setHidden = (name, val) => { const el = this.form.querySelector(`[name="${name}"]`); if (el) el.value = val; };
    setHidden('contact[request_meta]', composed);
    setHidden('contact[need]', data.needLabel || data.need);
    setHidden('contact[products]', data.productLabels.join(', '));
    setHidden('contact[timeline]', data.timelineLabel || data.timeline);
    // Keep the customer's brief as contact[body] so the Shopify inbox stays readable;
    // prepend the structured summary so staff see the choices even without JS email parsing.
    const body = this.form.querySelector('[name="contact[body]"]');
    if (body) body.value = composed;

    if (this.endpoint) {
      e.preventDefault();
      this.lock(true);
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            ...data,
            message: composed,
            turnstileToken: this.token,
            shop: window.Shopify?.shop || ''
          })
        });
        if (!res.ok) throw new Error('endpoint');
        this.showSuccess(data.email);
        track('design_services_submit', { via: 'endpoint' });
      } catch (err) {
        if (body) body.value = data.brief;
        this.showError(this.t.turnstile_failed);
        this.lock(false);
      }
      return;
    }

    // Native Shopify contact form. Turnstile is required in the UI; the token is
    // included as a field but Shopify will not verify it. Wire request_endpoint
    // to a Worker when the site key is configured for real protection.
    const tokenField = this.form.querySelector('[name="contact[turnstile]"]');
    if (tokenField) tokenField.value = this.token;
    track('design_services_submit', { via: 'contact' });
  }
  lock(on) {
    if (this.submitBtn) {
      this.submitBtn.disabled = on;
      this.submitBtn.textContent = on ? (this.t.sending || 'Sending…') : (this.t.send || 'Send request');
    }
  }
  showSuccess(email) {
    if (this.form) this.form.hidden = true;
    if (this.success) {
      this.success.hidden = false;
      if (this.successText) this.successText.textContent = fmt(this.t.success || '', { email });
      this.success.focus?.();
    }
  }
}

let turnstileLoader;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile'));
    document.head.appendChild(s);
  });
  return turnstileLoader;
}

if (!customElements.get('ds-compare')) customElements.define('ds-compare', DsCompare);
if (!customElements.get('ds-showcase')) customElements.define('ds-showcase', DsShowcase);
if (!customElements.get('ds-request')) customElements.define('ds-request', DsRequest);

document.querySelectorAll('a[href="#before-after"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const target = document.getElementById('before-after');
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => {
      const focusable = target.querySelector('h2, [tabindex], button, input');
      focusable?.focus?.();
    }, 300);
    track('design_services_cta_click', { from: 'before-after' });
  });
});
