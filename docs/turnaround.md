# Turnaround: 2nd Day by default, Next Day for +$5

Product page block **Production time** (`turnaround`, `snippets/rush-turnaround.liquid`, `assets/rush-turnaround.js`). It reuses the
rush-fee machinery described in [rush-turnaround.md](rush-turnaround.md) and adds a product-level data source.

## What the customer sees

| Situation | Shows |
|---|---|
| Product offers 2nd Day and Next Day | Two option rows. **2nd Day** (2 business days) is pre-selected and *Included*. **Next Day** (next business day) is `+$5.00`. |
| Product has one turnaround (4 business days, 7 business days, Next Day only) | A plain line: "Production time: 4 business days". No selector. |
| Per-spec rule removes Next Day for the chosen size/qty/config | The selector collapses to the plain line for that spec (it re-renders on every variant change). |
| No `printr.turnaround` metafield | Theme-side fallback (`assets/turnaround-config.json` + `snippets/turnaround-theme-config.liquid`): same selector or plain production-time line, by product. Only if the handle is not in that list: the old static text, or nothing when that text is blank. |

Choosing Next Day shows "Includes Next Day (+$5.00)" under the price and a total line in the block.
Shipping is separate ("Production time only. Shipping is calculated at checkout.").

## Data source: product metafield `printr.turnaround` (type JSON)

```json
{
  "v": 1,
  "tiers": [
    { "k": "2bd", "days": 2, "fee": 0, "default": true },
    { "k": "nbd", "days": 1, "fee": 5, "only": [{ "o": "Qty", "v": ["100", "250", "500"] }] }
  ]
}
```

- `k`: `std` (supplier standard, e.g. 4 or 7 business days), `2bd` (2nd Day) or `nbd` (Next Day).
- `days`: business days shown to the customer and written to the order.
- `fee`: flat USD per cart line (0 = included). The first `fee: 0` tier flagged `default` (else the first free tier) is pre-selected.
- Optional per-spec conditions on the selected variant's option values (option names are the product's own, Size / Qty / Config on configurator products):
  `only` (value must be in the list), `not` (value must not be in the list), `prefix` (value must start with one of the prefixes, e.g. a config family).
  A tier whose conditions fail is dropped for that variant.
- A paid tier is also dropped when the Rush Production fee product has no variant that can charge it, so a misconfigured store never shows a Next Day it cannot bill.
- Precedence: legacy variant metafields `printr.rush_2bd` / `printr.rush_nbd` (per-unit, Standard default) win over the product metafield, which wins over the theme-side fallback.

Examples: `{ "v":1, "tiers":[{ "k":"std","days":4,"fee":0 }] }` (4 days only), `{ "v":1, "tiers":[{ "k":"nbd","days":1,"fee":0 }] }` (Next Day is the only option).

## Theme-side fallback (no store metafield required)

Until the `printr.turnaround` metafield is created and filled, the theme reads `snippets/turnaround-theme-config.liquid`
(keep in sync with `assets/turnaround-config.json`). Owner decisions locked 2026-11-28:

- Next Day is a **flat $5 per cart line** (not multiplied by print quantity).
- **No price increases**: 2nd Day cost is absorbed in the current 2× price.
- **No Next Day** on unverified products (flags, signs, banners, stands, apparel, most specialty cards, 16pt/18pt postcards, raised cards) until a portal check confirms it. Those PDPs show the real production time only (usually 4 business days; 7 on foil and tear-resistant cards).
- Next Day +$5 is offered on verified families only: Business Card, Natural, Pearl, 14pt and 100lb gloss postcards, and Brochures. 2nd Day is the included default where 2 Day was confirmed (all of those except brochures Flat/Tri-fold, which default to 4 business days + Next Day). Shipping-included flyers show "Next business day" included, with no paid option.
- LED frame displays and tablecloths have no lead-time data, so they show no new line.

Once metafields are written, they win and this fallback stays only as a safety net.

## Charging the $5

Same hidden **Rush Production** fee product as the rush selector, added in the same `/cart/add` call as a Shopify nested line under the print item.
The fee is **flat per cart line** (it does not multiply by the print quantity):

- Preferred: a $5.00 variant with SKU `RUSH-NBD-FLAT` (and `RUSH-2BD-FLAT` if a paid 2nd Day is ever wanted). The fee line has quantity 1; checkout shows "Rush Production - Next Day  $5.00".
- Fallback (no store change): the existing $0.01 `RUSH-NBD` variant with quantity 500 (checkout shows x500 at $0.01).
- Taxable like the print item, no shipping, removed automatically with its print line (`assets/theme.js` `rushPlan`, flat fees keep `_rush_units`).

Print line properties: visible `Turnaround` is written for **every** order, including the included default
(`2nd Day (2 business days)`, `Next Day (next business day)`, `Standard (4 business days)`), always in English so production reads the same text in any language.
Hidden: `_rush_link`, `_rush_tier`, `_rush_cents`, `_rush_flat`, `_rush_units`, `_rush_fee_variant`.

## Strings (EN / ES)

| Key | EN | ES |
|---|---|---|
| `rush.tier_2bd` / `tier_2bd_sub` | 2nd Day / 2 business days | Segundo día / 2 días laborables |
| `rush.tier_nbd` / `tier_nbd_sub` | Next Day / Next business day | Próximo día / Próximo día laborable |
| `rush.tier_std` | Standard | Estándar |
| `rush.flat_note` | Includes {option} (+{amount}) | Incluye {option} (+{amount}) |
| `rush.cart_note` | Turnaround charge. Removed automatically with its print item. | Cargo por tiempo de entrega. Se elimina automáticamente con su artículo impreso. |

## Templates

`templates/product.brochures.json` (all configurator products) and `product.flat-flyers.json` now include a `turn` block after the configurator, with empty fallback text
so a product without the metafield shows nothing new. `snippets/turnaround-tier-ok.liquid` evaluates the per-spec conditions. The brochure configurator's leftover "Next business day" radio is hidden unless the product schema actually lists turnaround options, so it cannot contradict the Production time block.

## Tests

`cd tools/turnaround && npm i && npm test` renders the snippet with liquidjs (product/variant mocks) and runs the form-data and cart-reconciliation logic: 21 cases
(the original 16, plus theme-fallback business card / flag / brochures Half vs Flat / foil vs flyers, and metafield-wins-over-fallback).
Not covered here: the real Shopify Liquid engine and checkout; verify on an unpublished dev theme before merging.

## Still needs the owner (store writes, not in this PR)

These are not done and must not be done without explicit approval:

1. Create the product metafield definition `printr.turnaround` (JSON).
2. Write per-product values (plain 4/7-day lines from `metafields-plan.json`; selector values after a per-spec sweep).
3. Add a $5.00 variant SKU `RUSH-NBD-FLAT` on the hidden Rush Production product (taxable, no shipping). Until then the theme bills Next Day as the existing $0.01 `RUSH-NBD` variant × 500.
4. Optional: rename the two existing Rush Production variants to "2nd Day" / "Next Day" (the names appear at checkout).
5. Cutoff wording ("Approve artwork by …") — still open.
6. Merge this PR and a Customizer-tab reminder, after a dev-theme preview. Do not publish the preview theme.

LED frames and tablecloths still need a real lead time from the owner.
