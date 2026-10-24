# PRINTR — Shopify theme for Kawascopy

Original Online Store 2.0 theme for a print shop (business cards, postcards, flags…), built for a fast, accessible, conversion-focused storefront. Every line of code, CSS and copy is written from scratch.

## Stack
- JSON templates, section groups (`header-group`, `footer-group`), theme blocks (`blocks/`), `{% stylesheet %}` per component, `{% doc %}` LiquidDoc
- Vanilla JS web components (`assets/theme.js`, ES module, no jQuery): drawer, cart (Section Rendering API), product form, variant picker (`option_values`), predictive search, facets, slideshow, countdown, tabs, quick view, scroll reveal
- Locales: `en.default.json`, `es.json`
- Print identity: CMYK palette, crop marks, CMYK strip, paper-grain texture, Space Grotesk + Instrument Sans

## Print products
Create options such as **Size**, **Paper**, **Finish**, **Quantity**. Quantity values must start with a number (`100`, `250`, `500 cards`). The product page then shows a quantity-tier table with total, per-unit price and % savings for the current size/paper/finish combination, and clicking a tier selects it.
Optional metafields: `custom.turnaround` (single line text), `custom.price_tiers` (multi-line `qty:price`, used when there is no Quantity option).

## Develop
```
npm i -g @shopify/cli
shopify theme check
shopify theme dev --store <store>.myshopify.com
```

## Phase 2 features

- **Compare** (up to 4 products): card and product buttons feed a sticky compare bar and a `<dialog>` table with a "highlight differences" option. Turn it on or off under *Theme settings → Shopping tools*.
- **Wishlist**: heart buttons, a header count, and a `page.wishlist` template. Data is stored in localStorage and cards are rendered server-side through `?section_id=card-render`.
- **Recently viewed** section, **pickup availability** (updates when the variant changes), and a **cart shipping estimator**.
- **Lookbook** with hotspots (native Popover API), **Spotlight picks** (CSS-only `:has()`), a **Favorite products** carousel (native scroll-snap), a **scrolling gallery**, **buttons with icon**, and a **comparison table**.
- **Newsletter popup**: delay or exit intent, frequency cap, and Esc/focus handling through native `<dialog>`.
- **Collections**: grid/list switch, plus pagination by pages, a "load more" button, or infinite scroll.
- **Product page**: tabs, wishlist/compare/share buttons, and a sticky add-to-cart bar (it is `inert` while hidden).
- **Customer templates**: login/recover, register, account, order, addresses (country → province select), activate, reset.
  - New customer accounts also work: every link uses `routes.account_url`, so Shopify redirects automatically when they're enabled.
- **Motion**: cross-document view transitions, scroll-driven reveals with an IntersectionObserver fallback, a scroll progress bar and back-to-top.
  - All motion is turned off under `prefers-reduced-motion`.

## Local development & debugging

```bash
npm i -g @shopify/cli            # or: brew install shopify-cli
shopify theme check              # lint (should report 0 offenses)
shopify theme dev --store your-store.myshopify.com   # hot-reload preview at http://127.0.0.1:9292
shopify theme push --unpublished --store your-store.myshopify.com
```

Debugging tips:
- `shopify theme dev --verbose` prints request and sync logs. Add `?preview_theme_id=` to share a preview.
- Liquid errors show inline on the page. To check one section, open `/?section_id=<section>` (the Section Rendering API).
- Feature state is stored in localStorage under the keys `printr-wishlist`, `printr-compare`, `printr-recent`, `printr-layout` and `printr-popup`. Clear them in DevTools → Application to reset.
- The JS is plain ES modules (`assets/theme.js`, `assets/features.js`) with no build step.

## Manual upload

Online Store → Themes → Add theme → Upload zip file → choose `printr-theme.zip`. The zip has the theme folders at its root.
