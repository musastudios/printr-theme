/* Prefills the artwork mailto link from ?order=#1234 or the order field. */
class ArtworkDropoff extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector('[data-ad-order]'); this.link = this.querySelector('[data-ad-mailto]');
    const q = new URLSearchParams(window.location.search).get('order');
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
