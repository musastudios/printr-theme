# Artwork uploader + preflight (v1, theme-only)

Block **Artwork uploader** (`artwork_uploader`) in `sections/main-product.liquid` → `snippets/artwork-uploader.liquid` + `assets/artwork-uploader.js`.
Add it in the theme editor (Product template → Product information → Add block → Artwork uploader), above **Buy buttons**.

## How files are stored
- `<input type="file" name="properties[Artwork Front]">` / `properties[Artwork Back]` associated with `ProductForm-<section>` via the HTML `form` attribute (the block lives outside the buy block so it survives variant re-renders).
- Shopify's `{% form 'product' %}` renders `enctype="multipart/form-data"`; the theme's `<product-form>` posts `new FormData(form)` to `/cart/add.js`, which uploads the file to Shopify's CDN and stores its URL as the line item property (visible in cart, checkout and the order). Refs: https://shopify.dev/docs/storefronts/themes/architecture/templates/product#line-item-properties , https://shopify.dev/docs/api/ajax/reference/cart (FormData example), Dawn PR https://github.com/Shopify/dawn/pull/745.
- Extra properties: `Preflight` (human summary), `Artwork Fit` (rotation/scale/offset/DPI per side), `_preflight` (hidden JSON).
- **Limit:** ~20 MB per file (Shopify support statement, not in shopify.dev docs: https://community.shopify.com/t/does-the-basic-plan-for-a-digital-store-limit-storage-space/81342/4). Max size is a block setting capped at 20 MB. Upload happens on Add to cart, so large files make the click slow; there is no progress bar. Files don't survive a page reload before adding to cart.

## v2 for big files (up to 2 GB)
App proxy (`/apps/artwork/presign`) or a Cloudflare Worker that issues an R2/S3 presigned PUT (multipart for >100 MB), uploads directly from the browser with progress, then sets `properties[Artwork Front]` to the object URL/key. Optional: server-side preflight (Ghostscript/pdfcpu for PDF boxes/fonts/colour, ImageMagick for TIFF/EPS).

## Template size
Product metafields (`custom.trim_width_in`, `trim_height_in`, `bleed_in`, `safe_in`, `min_dpi` (default 300), `sides` 1|2) override block settings; otherwise trim is parsed from the variant option named Size/Tamaño (e.g. `2" x 3.5"`, `8.5x11`, `90 x 50 mm`), falling back to any option that parses.

## Checks (client-side)
| | Error (blocks cart) | Warning (needs "print as is") | Info |
|---|---|---|---|
| All | missing required side, bad extension, > max MB | no template size | |
| JPG/PNG | effective DPI < 150 | DPI < min_dpi, orientation mismatch (Auto-rotate), aspect ratio off > 2% | RGB → CMYK conversion (JPEG SOF 4 components / Adobe APP14 = CMYK) |
| PDF (pdf.js 4.10.38, lazy from jsDelivr) | | page size ≠ trim+bleed (±0.03"), trim size without bleed, rotated, page count ≠ sides | |
| TIF/TIFF/EPS | | | type+size only, not previewable |

Effective DPI = pixels / inches covered at the current placement (cover-fit × user scale), so scaling up lowers DPI live.

## Known limitations
- No CMYK/font/transparency check for PDFs; PDF colour not inspected. PNG colour profile ignored.
- Fit/rotation/position are recorded as properties only; the file itself is not modified — prepress must apply `Artwork Fit`.
- Dynamic checkout buttons are intercepted while blocked, but accelerated checkout may not carry file properties reliably; consider disabling them on artwork products.
- pdf.js loads from a CDN (needs network; can be vendored into assets later).
- 3D preview is a CSS tilt.

## v1.1: spec-driven, send-later, QA add-on
**Spec precedence (field by field):** variant `custom.print_spec` (metaobject: trim_w_in, trim_h_in, bleed_in, safe_in, min_dpi, warn_dpi, sides, pages, formats, special, optional panels) → product metafields / block settings → variant Size parse. All variants' specs are emitted as JSON so changing the variant re-applies the spec without a reload.
- DPI: with a spec, error < `min_dpi`, warn < `warn_dpi` (default max(min_dpi, 300)). Without one, error < 150, warn < product `min_dpi` (300). `large_format` defaults to error 75 / warn 150.
- `formats`: list or comma text (e.g. `pdf,jpg,png`) restricts the whitelist.
- `pages`: expected PDF page count (overrides the sides check).
- `special` (text, comma list or JSON list): `large_format`; `die_cut` (warning to include a CutContour path, cut line drawn dotted); `folds` / `folds:3` / `trifold` / `bifold` (purple fold lines from `panels`, a list of panel widths in inches like `[3.66,3.67,3.67]`, or equal panels); `apparel_area` (trim = print area, no bleed/safe/cut, art contain-fit inside).

**Artwork choice:** radio *Upload now* / *Send artwork after checkout*. Later mode disables the file inputs, sends `properties[Artwork]=Will send after checkout`, requires "I'll email my files…" and shows QA as Recommended.

**QA add-on:** block setting *Pre-flight & QA fee product*. When checked, the form's `formdata` event rewrites the payload into `items[0]…` (parent incl. files) + `items[1]` (fee, qty 1, `_for`=product title, `_artwork_link`, `_artwork_fee`) in the same `/cart/add.js` request. Parent gets `_artwork_link` + `Pre-flight QA: Yes`. `theme.js` `removeOrphanFees()` runs after every cart change and on cart page/drawer load and zeroes fee lines whose parent link is gone.

**Send-later page:** `templates/page.upload-artwork.json` → `sections/artwork-dropoff.liquid` (+ `assets/artwork-dropoff.js`, reads `?order=#1234` into a mailto). Email notification snippet: `docs/order-confirmation-artwork.md`.

## Hard gate (v2)

The artwork block (`templates/product.json` → `artwork`, before `ds`/`buy`) is step 1. Add to cart, Buy it now and the sticky bar stay `aria-disabled` (capture-phase click/keydown/submit guards, helper text via `aria-describedby`) until:

- **Art:** a file passed preflight, **or** "I'll send my artwork later" is ticked (adds `properties[Artwork]=Will send after checkout`), **or** a paid Design Service tier is chosen; **and**
- **Policy:** the required terms checkbox (EN/ES, links to `artwork_terms_url`, default `/pages/artwork-terms`) is ticked → `properties[Artwork terms]=Accepted <ISO time>`.

### Buy it now decision

Shopify's dynamic checkout (`payment_button`) skips multipart file upload and line-item extras (help.shopify.com/en/manual/online-store/dynamic-checkout/compatibility; Dawn #509/#731). Files, QA and Design lines would be lost. On products **with** the artwork block, `product-buy` renders a theme "Buy it now" button (same shape as Add to cart). It POSTs `new FormData(form)` to `/cart/add.js` (files plus formdata hooks), then goes to `/checkout`. Trade-off: no Shop Pay / Apple Pay express button on those products, and `/checkout` contains anything already in the cart. Products without the block keep native `payment_button`, now with rounded corners.

## Send-later → upload after paying

- **Customer accounts:** legacy (classic) account templates are theme Liquid, so `snippets/artwork-pending` adds a notice to `main-account` (list) and `main-order`. New customer accounts can't be themed; that needs a Customer Account UI extension (app). **Recommendation: keep legacy accounts** (Settings → Customer accounts) or build the extension later.
- A line is pending when it has `Artwork: Will send after checkout` and the order isn't tagged `artwork-received` (or cancelled). The link goes to `/pages/upload-artwork?order=#1234&email=…`.
- `/pages/upload-artwork` (section `artwork-dropoff`, "Show online uploader") reuses the same uploader, preflight and terms checkbox in standalone mode. It POSTs multipart (`order`, `email`, `shop`, `properties[...]`) to `artwork_upload_endpoint`. With no endpoint, or on failure, it opens `mailto:` with the order number.

### Proposed backend

**Cloudflare Worker + R2 (recommended):** it verifies the order name + email via the Admin API (`read_orders`), stores the files in R2 under `orders/<name>/`, adds the order tag `artwork-received` plus a note/metafield with the file links (`write_orders`), and emails the shop. Shopify Forms can't take file uploads or tag orders, so it only works as a contact fallback.

## Needs Juan's approval

1. Create the `/pages/artwork-terms` page (the policy text is legal copy) and the `upload-artwork` page using that template.
2. Set up the Worker/R2 and a custom app Admin API token (`read_orders`, `write_orders`), then set the endpoint in Theme settings.
3. Keep legacy customer accounts, or fund a UI extension.
4. Accept losing express-wallet Buy it now on artwork products.
5. Publishing / merging to main.

## Risks / untested

- Quick view (`quick-view-content`) has no gate, so products can be added from it without art or terms.
- Not tested on a live checkout. That includes file properties reaching the order and `/checkout` redirects with existing cart items.
- The order-page notice relies on the exact property string `Will send after checkout`.
