// PRINTR header: sticky state, hover/keyboard mega menu, category-scoped search.
(() => {
  if (customElements.get('sticky-header')) return;
  const desktop = matchMedia('(min-width: 990px)');

  class StickyHeader extends HTMLElement {
    connectedCallback() {
      this.setHeight();
      this.onScroll = () => this.classList.toggle('is-stuck', window.scrollY > 4);
      window.addEventListener('scroll', this.onScroll, { passive: true });
      this.ro = new ResizeObserver(() => this.setHeight());
      this.ro.observe(this);
      this.onScroll();

      this.megas = [...this.querySelectorAll('[data-mega]')];
      this.megas.forEach((d) => {
        let t;
        const li = d.parentElement;
        li.addEventListener('mouseenter', () => { if (!desktop.matches) return; clearTimeout(t); this.closeAll(d); d.open = true; });
        li.addEventListener('mouseleave', () => { if (!desktop.matches) return; t = setTimeout(() => { d.open = false; }, 120); });
        d.addEventListener('toggle', () => { if (d.open) this.closeAll(d); });
      });
      this.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = this.querySelector('[data-mega][open]');
        if (open) { open.open = false; open.querySelector('summary').focus(); }
      });
      this.onDocClick = (e) => { if (!this.contains(e.target)) this.closeAll(); };
      document.addEventListener('click', this.onDocClick);
      this.addEventListener('focusout', (e) => { if (!this.contains(e.relatedTarget)) this.closeAll(); });

      this.setupSearch();
    }
    disconnectedCallback() {
      window.removeEventListener('scroll', this.onScroll);
      document.removeEventListener('click', this.onDocClick);
      this.ro?.disconnect();
    }
    setHeight() { document.documentElement.style.setProperty('--header-height', `${this.offsetHeight}px`); }
    closeAll(except) { this.megas.forEach((m) => { if (m !== except) m.open = false; }); }
    setupSearch() {
      const ps = this.querySelector('[data-category-search]');
      if (!ps) return;
      const form = ps.querySelector('form');
      const select = ps.querySelector('[data-search-category]');
      const input = ps.querySelector('[data-search-input]');
      const results = ps.querySelector('[data-results]');
      form.addEventListener('submit', (e) => {
        const cat = select?.value;
        if (!cat || !input.value.trim()) return;
        e.preventDefault();
        const q = `${input.value.trim()} product_type:"${cat.replace(/"/g, '')}"`;
        window.location.href = `${form.action}?type=product&q=${encodeURIComponent(q)}&options[prefix]=last`;
      });
      document.addEventListener('click', (e) => {
        if (!ps.contains(e.target)) { results.hidden = true; input.setAttribute('aria-expanded', 'false'); }
      });
      input.addEventListener('focus', () => { if (results.innerHTML.trim() && input.value.trim().length > 1) results.hidden = false; });
    }
  }
  customElements.define('sticky-header', StickyHeader);
})();

