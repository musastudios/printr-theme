// PRINTR mega menu: <mega-menu> (hover intent, click, keyboard) + <mega-showroom> (ARIA tabs) + drawer focus trap.
(() => {
  if (customElements.get('mega-menu')) return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const panelOf = (b) => document.getElementById(b.getAttribute('aria-controls') || '');

  class MegaMenu extends HTMLElement {
    connectedCallback() {
      this.btns = [...this.querySelectorAll('[data-l1]')];
      this.btns.forEach((b) => {
        const li = b.closest('li');
        b.addEventListener('keydown', (e) => this.key(e, b));
        if (!panelOf(b)) return;
        b.addEventListener('click', (e) => { e.preventDefault(); this.set(b, b.getAttribute('aria-expanded') !== 'true'); });
        li.addEventListener('mouseenter', () => {
          if (!fine.matches) return;
          clearTimeout(this.t);
          this.t = setTimeout(() => this.set(b, true), 150);
        });
        li.addEventListener('mouseleave', () => {
          if (!fine.matches) return;
          clearTimeout(this.t);
          this.t = setTimeout(() => this.set(b, false), 250);
        });
      });
      this.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.cur) { const b = this.cur; this.set(b, false); b.focus(); }
      });
      this.addEventListener('focusout', (e) => {
        if (this.cur && !this.cur.closest('li').contains(e.relatedTarget)) this.set(this.cur, false);
      });
      document.addEventListener('click', (e) => { if (this.cur && !this.contains(e.target)) this.set(this.cur, false); });
    }
    set(b, open) {
      const p = panelOf(b);
      if (!p) return;
      if (open && this.cur && this.cur !== b) this.set(this.cur, false);
      b.setAttribute('aria-expanded', String(open));
      p.hidden = !open;
      b.closest('li').classList.toggle('is-open', open);
      if (open) document.documentElement.style.setProperty('--mega-top', `${Math.max(0, Math.round(p.getBoundingClientRect().top))}px`);
      if (open) this.cur = b; else if (this.cur === b) this.cur = null;
    }
    key(e, b) {
      const i = this.btns.indexOf(b);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = this.btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + this.btns.length) % this.btns.length];
        if (this.cur) this.set(this.cur, false);
        n.focus();
      } else if (e.key === 'ArrowDown' && panelOf(b)) {
        e.preventDefault();
        this.set(b, true);
        panelOf(b).querySelector('a, button')?.focus();
      }
    }
  }

  class MegaShowroom extends HTMLElement {
    connectedCallback() {
      const list = this.querySelector('[role=tablist]');
      this.tabs = [...list.querySelectorAll('[role=tab]')];
      const v = list.getAttribute('aria-orientation') !== 'horizontal';
      const next = v ? 'ArrowDown' : 'ArrowRight';
      const prev = v ? 'ArrowUp' : 'ArrowLeft';
      this.tabs.forEach((t, i) => {
        t.addEventListener('click', () => this.sel(i));
        t.addEventListener('mouseenter', () => { if (!fine.matches) return; clearTimeout(this.h); this.h = setTimeout(() => this.sel(i), 100); });
        t.addEventListener('mouseleave', () => clearTimeout(this.h));
        t.addEventListener('keydown', (e) => {
          let n = -1;
          if (e.key === next) n = (i + 1) % this.tabs.length;
          else if (e.key === prev) n = (i - 1 + this.tabs.length) % this.tabs.length;
          else if (e.key === 'Home') n = 0;
          else if (e.key === 'End') n = this.tabs.length - 1;
          if (n < 0) return;
          e.preventDefault(); e.stopPropagation();
          this.sel(n); this.tabs[n].focus();
        });
      });
    }
    sel(i) {
      this.tabs.forEach((t, k) => {
        const on = k === i;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const p = document.getElementById(t.getAttribute('aria-controls'));
        if (p) p.hidden = !on;
      });
      if (!fine.matches) this.tabs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /* Mobile chip row fades: left fade once scrolled, no right fade at the end. */
  const chipFade = (el) => {
    const upd = () => {
      el.classList.toggle('is-start', el.scrollLeft > 1);
      el.classList.toggle('is-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    };
    el.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    new ResizeObserver(upd).observe(el);
    upd();
  };
  document.querySelectorAll('.mobile-showroom__chips').forEach(chipFade);

  customElements.define('mega-menu', MegaMenu);
  customElements.define('mega-showroom', MegaShowroom);

  // Mobile drawer focus trap (open/close, Esc and scroll lock live in theme.js <drawer-panel>).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const d = document.querySelector('#MenuDrawer[open]');
    if (!d) return;
    const f = [...d.querySelectorAll('a[href], button, summary, input, [tabindex="0"]')].filter((x) => x.offsetParent && !x.closest('[hidden]'));
    if (!f.length) return;
    const a = f[0]; const z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    else if (!d.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
  });
})();
