// PRINTR hero slider: progressive enhancement on top of the vendored Swiper bundle.
(() => {
  if (customElements.get('slide-show')) return;
  class SlideShow extends HTMLElement {
    connectedCallback() {
      if (window.Swiper) this.init();
      else window.addEventListener('load', () => this.init(), { once: true });
    }
    init() {
      if (this.swiper || !window.Swiper) return;
      const slides = this.querySelectorAll('[data-track] > *');
      slides.forEach((s) => s.classList.add('swiper-slide'));
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const delay = Number(this.dataset.autoplay);
      const multi = slides.length > 1;
      this.swiper = new window.Swiper(this, {
        wrapperClass: 'swiper-wrapper',
        slidesPerView: 1,
        loop: multi,
        speed: reduce ? 0 : 700,
        effect: this.dataset.effect === 'fade' ? 'fade' : 'slide',
        fadeEffect: { crossFade: true },
        grabCursor: multi,
        allowTouchMove: multi,
        keyboard: { enabled: true, onlyInViewport: true },
        autoplay: multi && delay && !reduce ? { delay: delay * 1000, pauseOnMouseEnter: true, disableOnInteraction: false } : false,
        navigation: { prevEl: this.querySelector('[data-prev]'), nextEl: this.querySelector('[data-next]') },
        pagination: { el: this.querySelector('[data-pagination]'), clickable: true },
        a11y: { enabled: true, containerRoleDescriptionMessage: 'carousel', slideRole: 'group' }
      });
    }
    disconnectedCallback() { this.swiper?.destroy(true, true); this.swiper = null; }
  }
  customElements.define('slide-show', SlideShow);
  document.addEventListener('shopify:block:select', (e) => {
    const host = e.target.closest('slide-show');
    if (!host?.swiper) return;
    const idx = [...host.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate)')].indexOf(e.target.closest('.swiper-slide') || e.target);
    host.swiper.autoplay?.stop();
    if (idx > -1) host.swiper.slideToLoop(idx);
  });
})();
