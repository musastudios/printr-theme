# PRINTR — Shopify Theme Store readiness checklist

Status key: **PASS** = met in code · **FAIL** = known gap · **TODO** = needs action outside the codebase (partner account, stores, listing).

## Code and architecture
| Item | Status | Notes |
|---|---|---|
| Online Store 2.0: JSON templates, sections everywhere, app blocks (`@app`) | PASS | Product, collection, header, footer and generic sections accept app blocks |
| Theme blocks (`blocks/`) with presets | PASS | heading, text, button, image, slide, etc. |
| `shopify theme check` reports 0 offenses | PASS | Re-run before each submission |
| Required templates: index, product, collection, list-collections, cart, search, page, blog, article, 404, password, gift_card | PASS | |
| Customer accounts: `<shopify-account>` in the header (desktop and mobile), required since July 30, 2026 | PASS | `sections/header.liquid`; `customer_account_menu` setting |
| Gift card template: QR code, Apple Wallet, print, shop link, send-on date | PASS | `templates/gift_card.liquid`, deferred `vendor/qrcode.js` |
| Blog comments: form, pagination, moderation messages | PASS | `sections/main-article.liquid` |
| Product recommendations: related and complementary intents | PASS | `sections/related-products.liquid` |
| Image focal points respected | PASS | `presentation.focal_point` on image sections and blocks |
| Accelerated checkout buttons (product and cart, toggleable) | PASS | `cart_show_accelerated` |
| Follow on Shop in footer | PASS | `show_follow_on_shop` |
| Custom Liquid section | PASS | `sections/custom-liquid.liquid` |
| Unit pricing, sale/sold-out badges, variant images, filters, sort, predictive search | PASS | |
| Localization: en default and es locales; all strings translated; no hard-coded copy | PASS | |
| `powered_by_link` and external badges carry `rel="nofollow"` | PASS | |
| No parser-blocking scripts; no third-party CDN dependencies | PASS | |
| No app-like features | FAIL (risk) | Wishlist ships **off by default** (`wishlist_enable: false`) with an info note. Reviewers name wishlists explicitly; remove the feature before submission if flagged. Tier pricing table, compare and quick view are presentational. |

## Settings and copy
| Item | Status | Notes |
|---|---|---|
| Sentence case, no "&" in settings labels | PASS | "Logo and favicon", "Compare and share" |
| US English spelling in en locale | PASS | e.g. "Canceled" |
| `theme_info`: name, version 1.0.0, author | PASS | |
| `theme_documentation_url` / `theme_support_url` point to real docs and support | TODO | Placeholder kawascopy.com; needs a real docs site and support page |

## Presets and listings
| Item | Status | Notes |
|---|---|---|
| Multiple presets with distinct palettes | PASS | Printr (CMYK), Press (cream/black/red), Neon (dark/green/pink), Kraft (tan/brown/green) |
| `listings/<preset>/templates/index.json` for each preset | PASS | |
| One demo store per preset | TODO | Create in partner account and populate with print-shop content |
| Desktop screenshot 2000×2496 and mobile 750×1334 per preset, no browser chrome | PASS (draft) | `/workspace/printr-mockups/listing-*`; re-shoot from the real demo stores before submitting |
| Key highlight images 1600×1200 | PASS (draft) | `hero-composite-1600x1200.png`; more highlights needed |

## Performance and accessibility
| Item | Status | Notes |
|---|---|---|
| Lighthouse performance ≥ 60 (home, product, collection) on benchmark store | TODO | Run on the Shopify benchmark/demo store |
| Lighthouse accessibility ≥ 90 | TODO | Same; markup uses landmarks, skip link, focus styles, aria on drawers/carousels |
| Keyboard navigation, focus trap in drawers, reduced-motion support | PASS | |

## Submission (Juan only)
| Item | Status |
|---|---|
| Shopify Partner account and theme submission | TODO |
| Demo stores per preset | TODO |
| Theme listing copy, pricing, support email | TODO |
| Documentation site and support URL | TODO |
| Lighthouse runs on benchmark store | TODO |
