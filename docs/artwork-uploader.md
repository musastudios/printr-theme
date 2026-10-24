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
