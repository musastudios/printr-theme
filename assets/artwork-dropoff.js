/* Prefills the artwork mailto link from ?order=#1234 or the order field. */
class ArtworkDropoff extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector('[data-ad-order]'); this.link = this.querySelector('[data-ad-mailto]');
    const params = new URLSearchParams(window.location.search); const q = params.get('order');
    if (q) this.input.value = q.replace(/[^\w#-]/g, '').slice(0, 20);
    this.input.addEventListener('input', () => this.render()); this.render();
  }
  render() {
    let o = this.input.value.trim(); if (o && !o.startsWith('#')) o = `#${o}`;
    const subject = `${this.dataset.subject} ${o}`.trim();
    const body = this.dataset.body.replace('{order}', o || '#');
    this.link.href = `mailto:${this.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
}
if (!customElements.get('artwork-dropoff')) customElements.define('artwork-dropoff', ArtworkDropoff);

/* Post-checkout upload: same <artwork-uploader> (preflight + terms gate runs first in capture phase),
 * then multipart POST to the configured endpoint; no endpoint or a failure falls back to mailto. */
document.querySelectorAll('[data-ad-upload]').forEach((form) => {
  const t = JSON.parse(form.querySelector('[data-ad-strings]').innerHTML);
  const msg = form.querySelector('[data-ad-msg]'); const order = form.querySelector('[data-ad-up-order]'); const email = form.querySelector('[data-ad-up-email]');
  const params = new URLSearchParams(window.location.search);
  if (params.get('order')) order.value = params.get('order').replace(/[^\w#-]/g, '').slice(0, 20);
  if (params.get('email') && !email.value) email.value = params.get('email').slice(0, 120);
  const say = (s) => { msg.textContent = s; msg.hidden = false; };
  const mailto = (o) => { window.location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(`${t.subject} ${o}`.trim())}`; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let o = order.value.trim(); if (o && !o.startsWith('#')) o = `#${o}`;
    if (!o || !email.checkValidity() || !email.value) { say(t.need_order); (o ? email : order).focus(); return; }
    const endpoint = form.dataset.endpoint;
    if (!endpoint) { say(t.fallback); mailto(o); return; }
    const btn = form.querySelector('[type="submit"]'); btn.setAttribute('aria-busy', 'true'); btn.disabled = true; say(t.sending);
    try {
      const fd = new FormData(form); fd.set('order', o); fd.set('shop', window.Shopify?.shop || '');
      const res = await fetch(endpoint, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(String(res.status));
      say(t.sent.replace('{order}', o)); form.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
    } catch (err) { console.warn('[artwork-dropoff]', err); say(t.failed); mailto(o); btn.disabled = false; }
    finally { btn.removeAttribute('aria-busy'); }
  });
});
