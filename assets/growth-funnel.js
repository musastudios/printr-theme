const PTRS = /^PTRS\d{2}\d{6}$/i;
const REF_COOKIE = 'printr_ref';

function config() {
  return window.printrGrowth || {};
}

function readRef(search) {
  const params = new URLSearchParams(search);
  const raw = (params.get('ref') || '').trim().toUpperCase();
  return PTRS.test(raw) ? raw : '';
}

function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function applyDiscount(code, redirectPath) {
  const path = redirectPath || '/collections/all-print-products';
  const dest = `/discount/${encodeURIComponent(code)}?redirect=${path}`;
  if (window.location.pathname + window.location.search !== dest) {
    window.location.replace(dest);
  }
}

export function captureReferral(location = window.location, assign = applyDiscount) {
  const code = readRef(location.search);
  if (!code) return null;
  setCookie(REF_COOKIE, code, 30);
  const redirect = config().refRedirect || '/collections/all-print-products';
  const current = `${location.pathname}${location.search}`;
  if (!location.pathname.startsWith('/discount/')) {
    assign(code, redirect.startsWith('/') ? redirect : `/${redirect}`);
  }
  return { code, current };
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

function enhanceForm(form) {
  const cfg = config();
  if (!cfg.endpoint || !cfg.siteKey) return;
  const emailInput = form.querySelector('[data-growth-email], input[type="email"]');
  const status = form.querySelector('[data-growth-status]');
  const submit = form.querySelector('[data-growth-submit], button[type="submit"]');
  const host = form.querySelector('[data-growth-turnstile]');
  const source = form.querySelector('[name="growth-source"]')?.value || form.getAttribute('data-growth-source') || 'homepage';
  let token = '';
  let widgetId;

  const show = (msg, isError) => {
    if (!status) return;
    status.hidden = false;
    status.textContent = msg;
    status.classList.toggle('form-error', Boolean(isError));
  };

  if (host) {
    loadTurnstile()
      .then(() => {
        widgetId = window.turnstile.render(host, {
          sitekey: cfg.siteKey,
          callback: (value) => { token = value; if (submit) submit.disabled = false; },
          'expired-callback': () => { token = ''; if (submit) submit.disabled = true; },
          'error-callback': () => { token = ''; show(cfg.strings?.turnstile_failed || 'Verification failed.', true); }
        });
        if (submit) submit.disabled = true;
      })
      .catch(() => show(cfg.strings?.turnstile_failed || 'Verification failed.', true));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!token) {
      show(cfg.strings?.turnstile_required || 'Complete verification to subscribe.', true);
      return;
    }
    if (submit) submit.disabled = true;
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: emailInput?.value,
          locale: cfg.locale || document.documentElement.lang || 'es',
          source,
          turnstileToken: token
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'subscribe_failed');
      show(cfg.strings?.success || 'Check your email to confirm your subscription.');
      form.setAttribute('data-growth-success', 'true');
    } catch (err) {
      show(cfg.strings?.error || 'We could not subscribe you. Try again.', true);
      if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId);
      token = '';
      if (submit) submit.disabled = false;
    }
  });
}

function boot() {
  captureReferral();
  document.querySelectorAll('form[data-growth-form], form.growth-form').forEach(enhanceForm);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export { readRef, PTRS };
