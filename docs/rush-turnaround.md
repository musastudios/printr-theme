# Production time / rush selector

Product page block **Production time** (`turnaround`, `snippets/rush-turnaround.liquid`, `assets/rush-turnaround.js`).

## What the customer sees

When the selected variant has rush surcharges, the block shows:

| Option | Shown when | Price |
|---|---|---|
| Standard (N business days) | always | Included |
| 2 Business Days | variant metafield `printr.rush_2bd` > 0 | `+$rush_2bd` |
| Next Business Day | variant metafield `printr.rush_nbd` > 0 | `+$rush_nbd` |

- N = variant metafield `printr.standard_days`, else Theme settings → Production turnaround → Standard production time (default 4).
- The product price (and sticky bar) shows variant price + surcharge, with "Includes … rush (+$X)" under it, and a total line in the block.
- Variant changes re-render the block (variant picker / tier rows swap `[data-swap="turnaround"]`; other sources reload it via the Section Rendering API). The customer's choice is kept when the new variant offers it; otherwise it falls back to Standard with a notice.
- No rush metafields on the variant, or no fee product → the old static "Production time: …" line. Nothing changes for existing products.
- In templates that use the brochure configurator, if this block is added and rush is offered, the configurator's own Turnaround radio is hidden and its turnaround property is replaced.

## How the surcharge is charged

The store is on the Basic plan, so Cart Transform `lineUpdate` (price override) and Functions in custom apps (Plus only) are not available. Shopify also has no native line fee. The rush is charged with a hidden **fee product** added in the **same `/cart/add` call** as the print item:

- Fee product **Rush Production** (handle `rush-production`), one **$0.01** variant per tier: `RUSH-2BD` "2 Business Days", `RUSH-NBD` "Next Business Day".
- Fee line quantity = surcharge in cents × print line quantity (max surcharge today $1,894.96 = 189,496 units; Shopify's line limit is 1,000,000).
- The fee line is a Shopify **nested cart line** (`parent_id` = print variant), so Shopify removes it when the print line is removed and shows it under the print item in cart, checkout, order status, emails and the admin order. If a store ever refuses `parent_id`, the add is retried without it and the theme keeps the link through `_rush_link`.
- Print line properties: visible `Turnaround` (`Standard (4 business days)` / `2 Business Days (rush)` / `Next Business Day (rush)`, always in English for production) and hidden `_rush_link`, `_rush_tier`, `_rush_cents` (per unit), `_rush_fee_variant`.
- Fee line properties (hidden): `_rush_link`, `_rush_fee` (tier), `_for` (print item, shown in the theme cart as "For: …").
- `assets/theme.js` (`rushPlan`) reconciles on every cart load/change: fee qty = `_rush_cents` × print qty, orphan or duplicate fee lines removed, a missing fee line re-added (once per page view) nested under its print line.
- Cart UI: fee lines have no quantity box or Remove link; the cart count leaves fee units out (`snippets/cart-count.liquid`).
- Tax: the fee product is **taxable**, so IVU applies to rush exactly like the print product. It does **not** require shipping, so it adds no weight and is never part of shipping.

Limits to know:
- Checkout shows the fee as "Rush Production – Next Business Day" with its quantity (e.g. ×1144 at $0.01). This is the standard pattern on non-Plus stores.
- `_rush_cents` comes from the storefront. Before production, staff should check that an order's rush line matches the variant's `printr.rush_*` value (a Shopify Flow check can flag mismatches).
- Order-level discount codes apply to the fee line unless the discount is limited to products/collections that exclude Rush Production.
- The free-shipping progress bar uses cart total, which includes rush.

## Fee product spec (create in admin, then select it in Theme settings → Production turnaround)

| Field | Value |
|---|---|
| Title / handle | Rush Production / `rush-production` |
| Vendor / type | PRINTR / Service fee |
| Status / channels | Active / Online Store only (Ajax cart needs it), no other channels |
| Option | Turnaround: `2 Business Days`, `Next Business Day` |
| Variant price | $0.01 each; SKUs `RUSH-2BD`, `RUSH-NBD` |
| Taxable | Yes (IVU like products) |
| Requires shipping | No (weight 0) |
| Inventory | Not tracked, continue selling |
| SEO | metafield `seo.hidden` = 1 (hidden from search and sitemap); no collections |
