# Turnaround: 2nd Day by default, Next Day for +$5

Product page block **Production time** (`turnaround`, `snippets/rush-turnaround.liquid`, `assets/rush-turnaround.js`). It reuses the
rush-fee machinery described in [rush-turnaround.md](rush-turnaround.md) and adds a product-level data source.

## What the customer sees

| Situation | Shows |
|---|---|
| Product offers 2nd Day and Next Day | Two option rows. **2nd Day** (2 business days) is pre-selected and *Included*. **Next Day** (next business day) is `+$5.00`. |
| Product has one turnaround (4 business days, 7 business days, Next Day only) | A plain line: "Production time: 4 business days". No selector. |
| Per-spec rule removes Next Day for the chosen size/qty/config | The selector collapses to the plain line for that spec (it re-renders on every variant change). |
| No `printr.turnaround` metafield | Unchanged: the old static text (`custom.turnaround` / block setting), or nothing when that text is blank. |

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
- Precedence: legacy variant metafields `printr.rush_2bd` / `printr.rush_nbd` (per-unit, Standard default) win over the product metafield, so nothing existing changes.

Examples: `{ "v":1, "tiers":[{ "k":"std","days":4,"fee":0 }] }` (4 days only), `{ "v":1, "tiers":[{ "k":"nbd","days":1,"fee":0 }] }` (Next Day is the only option).

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
so a product without the metafield shows nothing new. `snippets/turnaround-tier-ok.liquid` evaluates the per-spec conditions.

## Tests

`cd tools/turnaround && npm i && npm test` renders the snippet with liquidjs (product/variant mocks) and runs the form-data and cart-reconciliation logic: 16 cases
(default 2nd Day, Next Day flat fee, flat vs per-unit quantity, per-spec removal, 4-day-only, Next-Day-only, missing fee product, prefix/not rules, ES strings, legacy mode, no metafield).
Not covered here: the real Shopify Liquid engine and checkout; verify on an unpublished dev theme before merging.

## Not decided in code (owner decisions)

- Whether 2nd Day really is the default where the supplier charges +10% for it (PRINTR absorbs it in the 2x price unless prices change).
- Cutoff time wording ("order and approve artwork by ...").
- Flat $5 per cart line vs per item.
