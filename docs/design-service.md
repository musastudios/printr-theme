# Design Service add-on: setup

Theme side ships in `snippets/design-service.liquid`, `assets/design-service.js`, the `Design service` block in
`sections/main-product.liquid` (already placed above Buy buttons in `templates/product.json`), cart handling in
`snippets/cart-lines.liquid` + `assets/theme.js`, and the brief mode in the artwork uploader.

**Nothing below has been created in the store.** Every step is a manual admin action that needs Juan's approval.
Items in [brackets] are unconfirmed.

## 1. Create the hidden product "Design Service"

Shopify admin → **Products → Add product**

| Field | Value |
|---|---|
| Title | `Design Service` (ES translation: `Servicio de Diseño` via Translate & Adapt) |
| Description | `Professional design help for your print order: Touch-Up, Refresh, or Fresh Look.` / ES: `Ayuda profesional de diseño para tu impresión: Retoque, Renovación o Diseño Nuevo.` |
| Media | `printr-art/design-service/design-service_01-main.jpg` |
| Status | Active |
| Product type | `Service` |
| URL handle (Search engine listing → Edit) | `design-service` |

Options / variants: one option **Tier**, values in this order (the theme falls back to this order if SKUs are missing):

| Tier value | Price | SKU | Track quantity | Physical product |
|---|---|---|---|---|
| Touch-Up | 25.00 | `DS-TOUCHUP` | off | **off** (no shipping) |
| Refresh | 50.00 | `DS-REFRESH` | off | **off** |
| Fresh Look | 75.00 | `DS-FRESH` | off | **off** |

- **Charge tax:** [TBD with Juan / accountant; PR IVU on services]. Set the same on all 3 variants.
- **Inventory:** "Track quantity" unchecked on every variant (variants stay available).
- **Shipping:** "This is a physical product" unchecked on every variant, so a design-only cart needs no shipping.
- **Sales channels:** Online Store **on** (required so `/cart/add` accepts the variants). Leave Shop / POS off.
- **Collections:** do not add to any collection; make sure no automated collection rule (e.g. "all products",
  price-based) catches it. Check Products → the product → Collections after saving.
- **Hide from search / sitemap:** add the product metafield `seo.hidden` = `1` (integer):
  Settings → Custom data → Products → **Add definition** is *not* needed; instead use the bulk editor URL
  `https://admin.shopify.com/store/printr-theme/bulk?resource_name=Product&edit=metafields.seo.hidden:integer&ids=<PRODUCT_ID>`
  and enter `1`, or run (Admin GraphQL, e.g. from the GraphiQL app):

```graphql
mutation { metafieldsSet(metafields: [{ ownerId: "gid://shopify/Product/<PRODUCT_ID>", namespace: "seo", key: "hidden", type: "number_integer", value: "1" }]) { userErrors { field message } } }
```

`seo.hidden = 1` removes the product from storefront search, sitemap and adds noindex
(https://help.shopify.com/en/manual/promoting-marketing/seo/hide-a-page-from-search-engines , inferred: not re-checked this session). The product URL still works.

### Hook it up in the theme
Online Store → Themes → **Customize** → Products → Default product → **Design service** block →
pick `Design Service` in "Design Service product". Defaults: "Hide QA fee with a paid tier" **on**,
"Quote link" `/pages/design-services` [unconfirmed page].

## 2. What lands on the order

Print line (parent):
- `Design Service: Refresh` (visible), `_design_tier: refresh`, `_parent_key: ds…` (hidden)
- `Artwork: Brief after checkout (Design Service)` when a paid tier was picked (the uploader stops requiring files)

Design line (child, qty locked to 1):
- `Design tier: Refresh` (visible), `_design_tier: refresh`, `_parent_key: ds…` (same key),
  `_for: Standard Business Cards – 500`, `_parent_url` (hidden)

Removing the print line from the cart removes its design line (orphan cleanup in `assets/theme.js`).
The visible tier names are localized (ES orders show `Retoque/Renovación/Diseño Nuevo`); use `_design_tier`
(`touchup|refresh|fresh`) or the SKU for automation.

## 3. Staff order notification (Settings → Notifications → Staff notifications → **New order** → Edit code)

Paste near the top of the body (after the order heading):

```liquid
{%- assign ds_lines = '' -%}
{%- for line in line_items -%}
  {%- if line.sku contains 'DS-' -%}
    {%- assign ds_for = '' -%}{%- assign ds_key = '' -%}
    {%- for p in line.properties -%}
      {%- if p.first == '_for' -%}{%- assign ds_for = p.last -%}{%- endif -%}
      {%- if p.first == '_parent_key' -%}{%- assign ds_key = p.last -%}{%- endif -%}
    {%- endfor -%}
    <table style="width:100%;margin:12px 0;border:3px solid #000;border-radius:8px;background:#FFF915;"><tr><td style="padding:12px;">
      <strong>DESIGN SERVICE: {{ line.variant.title }} ({{ line.final_line_price | money }})</strong><br>
      For: {{ ds_for | default: 'n/a' }}
      {%- for other in line_items -%}
        {%- for q in other.properties -%}
          {%- if q.first == '_parent_key' and q.last == ds_key and other.sku != line.sku -%}
            <br>Linked item: {{ other.title }} × {{ other.quantity }}
          {%- endif -%}
        {%- endfor -%}
      {%- endfor -%}
      <br>Brief: waiting for customer (tag <code>brief-received</code> when it arrives).
    </td></tr></table>
  {%- endif -%}
{%- endfor -%}
```

The existing line loop in the template already prints visible properties (`Design Service: …`, `Design tier: …`);
hidden `_` properties only show through the snippet above.
Variable names follow https://help.shopify.com/en/manual/fulfillment/setup/notifications/email-variables (verified that
`line_items`, `line.properties`, `line.sku`, `line.variant.title` exist; behaviour of `_` properties in the stock loop is inferred).

## 4. Customer order confirmation (Settings → Notifications → Customer notifications → **Order confirmation** → Edit code)

Paste right after the opening "Thank you for your purchase" paragraph (outside the line loop). It complements the
artwork-later block from `docs/order-confirmation-artwork.md`.

```liquid
{%- assign ds_tier = '' -%}
{%- for line in line_items -%}
  {%- if line.sku contains 'DS-' -%}{%- assign ds_tier = line.variant.title -%}{%- endif -%}
{%- endfor -%}
{%- if ds_tier != '' -%}
  <table class="row" style="margin-top:16px;"><tr><td style="padding:16px;border:3px solid #000;border-radius:12px;background:#FFF915;">
    <p style="margin:0 0 8px;font-weight:bold;">Next step: send your file and a short brief ({{ ds_tier }})</p>
    <p style="margin:0 0 12px;">Tell us your logo, text, colors, references and deadline. We'll send a digital proof in [1–2 business days] after we get it. Printing starts when you approve.</p>
    <a href="{{ shop.url }}/pages/design-brief?order={{ order.name | url_encode }}&email={{ email | url_encode }}" style="display:inline-block;padding:12px 20px;background:#000;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">Send my brief</a>
    <p style="margin:12px 0 0;font-size:13px;">Spanish: “Siguiente paso: envía tu archivo y una breve descripción” · “Enviar mi descripción”.</p>
  </td></tr></table>
{%- endif -%}
```

Optional: showing the same link on the Thank-you / Order status page needs a checkout UI extension or app block [needs decision; not built].

## 5. Brief page
Create **Online Store → Pages → Add page** `Design brief`, handle `design-brief`, and embed the brief form
(see `docs/design-service-automation.md` for the recommended Shopify Forms setup).
