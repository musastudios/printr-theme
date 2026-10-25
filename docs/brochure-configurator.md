# Brochure configurator (presentation layer)

Status: theme code only. **No product, variant or metafield exists on the store yet.** Nothing here has been pushed to any theme.

## Pieces

| File | Role |
|---|---|
| `assets/brochure-configurator.js` | Options engine (`createEngine`), adapters (`StaticJsonAdapter`, `SupplierApiAdapter` stub) and the `<brochure-configurator>` element. Exposed as `window.PrintrConfigurator`. |
| `snippets/brochure-configurator.liquid` | Markup, JSON payloads (config, product variants, strings) and CSS. Reuses the `.tiers--radio` row styling from `snippets/tier-pricing.liquid`. |
| `sections/main-product.liquid` | New block `brochure_config` ("Brochure configurator", 21 chars). |
| `assets/brochure-configurator.json` | Fallback config when the product has no `custom.configurator` metafield. |
| `assets/artwork-uploader.js` | `expandOptions()` reads merged Config codes (e.g. `GB100-44-AQ-TRI`) so the uploader picks up sides (4/4 → 2) and fold (TRI → 3 panels, HALF → 2). |
| `locales/en.default.json`, `locales/es.json` | `products.product.configurator.*` strings. |
| `tools/brochures/generate.mjs` + `cost-samples.csv` | Offline generator (ignored by `.shopifyignore`, never pushed). |

## Flow

1. Customer picks in order: **size → paper (stock) → print colors (colorspec) → coating → fold → quantity**.
2. Rules disable values of a later step given earlier choices. On every change the engine re-walks the steps; any later choice that became invalid is replaced with the first valid value and a notice ("Updated to stay compatible: Fold") is announced via `aria-live`.
3. The quantity table shows a live total / unit / savings per tier.
4. The selection maps to a variant. If it exists, has a price and is available:
   - `input[name=id]` in `ProductForm-<section>` is set to that variant;
   - hidden `properties[...]` inputs (bound with `form=`) carry every human-readable choice plus `properties[_spec]` (JSON: size, stock, colorspec, coating, fold, qty, config, turnaround);
   - `document` receives `variant:change` `{ variantId, sectionId, source, spec }`, which the artwork uploader already listens to (trim size from the Size option, sides + fold panels from the Config code).
5. Otherwise the id is cleared, Add to cart / Buy now are disabled and the **Request a quote / Solicitar cotización** box appears with a prefilled link (block setting `quote_url`, default `/pages/contact`).

Template setup: add "Brochure configurator" above "Artwork uploader" and "Buy buttons"; remove "Variant picker" and "Quantity tier pricing" on the brochures template.

## Rules

```json
{ "id": "no-tri-5x8", "when": { "size": ["5.5x8.5"] }, "excludes": { "fold": ["TRI"] }, "reason": { "en": "…", "es": "…" } }
{ "id": "aq-needs-gb100", "when": { "coating": ["AQ"] }, "only": { "stock": ["GB100"] }, "reason": { "en": "…", "es": "…" } }
```

`when` matches earlier steps only; `excludes` / `only` target a later step (including `qty`). `"enabled": false` keeps a rule documented but inactive. No restrictions were observed in the supplier portal yet, so both shipped rules are disabled examples. The harness enables the first one to show the reset behaviour.

## Variant mapping and budget

Shopify allows 3 options and 2048 variants per product. Dimensions are merged:

| Option | Values | Count |
|---|---|---|
| Size | 11x17, 5.5x8.5, 8.5x11, 8.5x14 | 4 |
| Qty | 100, 250, 500, 1000, 2500, 5000 | 6 |
| Config = stock-colors-coating-fold | `GB100` × `40/44/41` × `AQ/NC` × `TRI/FLAT/HALF` | 1×3×2×3 = 18 |

4 × 6 × 18 = **432 variants** (21% of 2048). Headroom: adding stocks multiplies by the stock count: 4 stocks → 1728 (fits), 5 stocks → 2160 (does not fit). Beyond ~4 stocks, or once more sizes are added, switch to the on-demand path: `SupplierApiAdapter.resolveVariant()` asks a Worker to create the variant just in time (or split products per stock). The UI does not change.

Config code examples: `GB100-44-AQ-TRI`, `GB100-40-NC-FLAT`, `GB100-41-AQ-HALF`.

## Data adapter interface

```js
getSchema(product)   // { groups, qty, options_map, config_code, turnaround, title }
getRules()           // rules array
getPrice(selection)  // { price | null, source: 'variant' | 'real' | 'placeholder' | 'quote', variant }
resolveVariant(sel)  // { id, available, price } | null
```

- `StaticJsonAdapter` reads the config JSON from the metafield `custom.configurator` (type JSON, rendered inline) or fetches `assets/brochure-configurator.json`, and resolves variants from the product's real variants (match on Size | Qty | Config). Price comes from the variant when it exists, else the JSON price, else quote.
- `SupplierApiAdapter` is a stub with the same methods; proposed endpoints are documented in the file (`GET schema`, `GET rules`, `POST price`, `POST variant`). Swap it in the element without UI changes.

## Generator

```
node tools/brochures/generate.mjs <outDir>
```

Writes `configurator.json`, `product-payload.json` (1 DRAFT product, 432 variants, metafield placeholder) and `price-report.json`. Price = cost × 2. Only rows in `cost-samples.csv` are real; all other prices are `null` in the config (quote) and `REQUIRES_PRICE` in the payload, so the payload cannot be created until priced. It never calls the store.

### Prices today

Real (11x17, 100lb Gloss Book, 4/4, Aqueous, Tri-fold, next business day):

| Qty | Cost | Our price (×2) |
|---|---|---|
| 100 | 84.48 | 168.96 |
| 250 | 141.73 | 283.46 |
| 500 | 240.60 | 481.20 |
| 1000 | 325.00 | 650.00 |
| 2500 | 463.80 | 927.60 |
| 5000 | 655.00 | 1,310.00 |

Placeholder: the other 426 variants (17 configs × 6 qty for 11x17, plus all of 5.5x8.5, 8.5x11 and 8.5x14). Job sample add-on: cost 9.99, proposed 19.98, maps to the existing QA/proof product in the artwork uploader (not rendered as a second fee).

## Harness

`/workspace/printr-art/brochure-configurator/` (outside the repo): `index.html`, `index.es.html`, `shoot.py`, screenshots at 1280 and 390 (default, 1000-tier add to cart, quote state, rule reset).

## Store product (created 2026-10-25, DRAFT)

- Product: "Brochures", handle `brochures`, id `gid://shopify/Product/15424535462062`, status DRAFT, published to 0 channels.
- Options: Size (4) | Qty (6) | Config (18) = 432 variants. Config packs `GB100-{colorspec}-{coating}-{fold}`; the configurator UI splits it into separate Size, Colorspec, Coating, Fold and Quantity controls.
- 6 variants are really priced (11x17, 4/4, Aqueous, Tri-Fold; cost x 2). `custom.price_status` = `real`.
- **426 variants are PLACEHOLDERS at price 0.00** (`custom.price_status` = `placeholder`, product tag `needs-price`). The configurator JSON has no price for them, so the UI shows "Request a quote" and doesn't add them to the cart. A direct `/cart/add` with their variant id would still sell at $0, so **do not publish this product until every placeholder has a real price** (or until those variants are removed).
- Metafields: `custom.configurator` (json, from tools/brochures/generate.mjs) and `custom.print_profile` -> `flat-flyers-brochures`. No product-level `print_spec` is set, because specs are per size.
