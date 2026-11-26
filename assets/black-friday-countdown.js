(() => {
  const HOUR = 3600;
  const DAY = 86400;

  function pad2(value) {
    return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
  }

  function normalizeDateTime(value) {
    if (value == null) return "";
    let text = String(value).trim();
    if (!text) return "";
    text = text.replace(" ", "T");
    text = text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    return text;
  }

  function parseTarget(value) {
    const text = normalizeDateTime(value);
    if (!text) return NaN;
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? NaN : ms;
  }

  function remainingParts(targetMs, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    const total = Math.max(0, Math.floor((targetMs - now) / 1000));
    return {
      total,
      expired: total <= 0,
      days: Math.floor(total / DAY),
      hours: Math.floor((total % DAY) / HOUR),
      minutes: Math.floor((total % HOUR) / 60),
      seconds: total % 60
    };
  }

  function prefersReducedMotion() {
    return typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function setDigit(el, value) {
    if (!el) return;
    const next = pad2(value);
    if (el.textContent === next) return;
    el.textContent = next;
    if (prefersReducedMotion()) return;
    el.classList.remove("is-tick");
    void el.offsetWidth;
    el.classList.add("is-tick");
  }

  async function copyText(value) {
    const text = String(value || "");
    if (!text) return false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through to execCommand */ }

    if (typeof document === "undefined") return false;

    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    input.remove();
    return ok;
  }

  if (typeof window !== "undefined" && window.HTMLElement && window.customElements && !customElements.get("bf-countdown")) {
    class BlackFridayCountdown extends HTMLElement {
      connectedCallback() {
        this.target = parseTarget(this.dataset.target);
        this.expiredBehavior = this.dataset.expiredBehavior || "hide";
        this.live = this.querySelector("[data-bf-live]");
        this.expired = this.querySelector("[data-bf-expired]");
        this.fallback = this.querySelector("[data-bf-fallback]");
        this.daysEl = this.querySelector("[data-days]");
        this.hoursEl = this.querySelector("[data-hours]");
        this.minutesEl = this.querySelector("[data-minutes]");
        this.secondsEl = this.querySelector("[data-seconds]");
        this.copyButtons = [...this.querySelectorAll("[data-bf-copy]")];

        this.copyButtons.forEach((btn) => {
          btn.addEventListener("click", (event) => this.onCopy(event, btn));
        });

        if (this.fallback) this.fallback.hidden = true;
        if (Number.isNaN(this.target)) {
          this.showFallback();
          return;
        }

        this.classList.add("is-ready");
        this.tick();
        this.timer = setInterval(() => this.tick(), 1000);
      }

      disconnectedCallback() {
        clearInterval(this.timer);
      }

      showFallback() {
        if (this.fallback) this.fallback.hidden = false;
        if (this.live) this.live.hidden = true;
      }

      onExpire() {
        clearInterval(this.timer);
        this.classList.add("is-expired");
        if (this.expiredBehavior === "message") {
          if (this.live) this.live.hidden = true;
          if (this.expired) this.expired.hidden = false;
          return;
        }
        const section = this.closest(".shopify-section");
        if (this.expiredBehavior === "hide-section" && section) {
          section.hidden = true;
          return;
        }
        this.hidden = true;
      }

      tick() {
        const parts = remainingParts(this.target);
        setDigit(this.daysEl, parts.days);
        setDigit(this.hoursEl, parts.hours);
        setDigit(this.minutesEl, parts.minutes);
        setDigit(this.secondsEl, parts.seconds);
        if (this.live) this.live.hidden = false;
        if (this.expired) this.expired.hidden = true;
        if (parts.expired) this.onExpire();
      }

      async onCopy(event, btn) {
        event.preventDefault();
        const code = btn.getAttribute("data-code") || btn.dataset.code || "";
        const ok = await copyText(code);
        if (!ok) return;
        const label = btn.querySelector("[data-bf-copy-label]");
        const original = label ? label.textContent : btn.textContent;
        const copied = btn.getAttribute("data-copied-label") || "Copied!";
        btn.classList.add("is-copied");
        btn.setAttribute("aria-live", "polite");
        if (label) label.textContent = copied;
        else btn.textContent = copied;
        clearTimeout(this.copyReset);
        this.copyReset = setTimeout(() => {
          btn.classList.remove("is-copied");
          if (label) label.textContent = original;
          else btn.textContent = original;
        }, 2000);
      }
    }

    customElements.define("bf-countdown", BlackFridayCountdown);
  }

  const api = { pad2, normalizeDateTime, parseTarget, remainingParts, copyText };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else if (typeof window !== "undefined") {
    window.BlackFridayCountdown = api;
  }
})();
