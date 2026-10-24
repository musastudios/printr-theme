# Print profiles & print specs

The artwork uploader (`snippets/artwork-uploader.liquid` + `assets/artwork-uploader.js`) adapts to each product
from two metaobject types in Shopify Admin (Content → Metaobjects). No code change is needed to add products.

## Data model

| Object | What it is | Key fields |
| --- | --- | --- |
| **Print spec** (`print_spec`) | One printable size | `label`, `trim_w_in`, `trim_h_in`, `bleed_in` (per side), `safe_in`, `min_dpi` (block below), `warn_dpi` (warn below), `sides` (number of files), `pages`, `formats` (PDF/JPG/PNG/TIFF/EPS), `special` (mode), `panels` (fold panel widths, JSON list), `detail` (mode JSON), `notes` (shown to customer) |
| **Print profile** (`print_profile`) | A product family, e.g. *Feather Flags* | `name`, `mode`, `color_mode`, `formats`, `guidance` (shown to customer), `template_file` / `template_url` (optional download), `sizes` (list of print specs), `default_size` |

Metafields:

* Product `custom.print_profile` → the family.
* Product `custom.print_spec` → the size for single-size products (all current products).
* Variant `custom.print_spec` → optional override for one variant.

Modes (`special` / `mode`): `flat`, `die_cut`, `folds`, `large_format`, `grommets`, `apparel_area`.
They drive the guides drawn on the canvas (fold lines, apparel print box), DPI defaults and the info lines in preflight.

## How a variant resolves its spec

1. Variant `custom.print_spec` (override).
2. Profile `sizes` entry whose trim matches a size in the variant's options (e.g. a `Size` option `24" x 81"`, either orientation).
3. Product `custom.print_spec`, then profile `default_size`.
4. Legacy fallbacks: product metafields `bleed_in`/`safe_in`/`min_dpi`/`trim_*`, block settings, parsing a size from the option.

Number of files: the spec's `sides`, overridden by the variant's finish when it says so
(`4/0 Color` or `Single-Sided` → 1 file; `4/4`, `5/1`, `Double-Sided` → front + back). Apparel uses the spec only.

## Add a product to an existing family

1. Open the product → Metafields → **Print profile**: pick the family (e.g. *Feather Flags*).
2. **Print spec**: pick the matching size. If the size doesn't exist, create it (below) and also add it to the profile's `sizes`.
3. Save and check the product page: the uploader shows the family guidance, size, DPI and the right number of upload tiles.

If one product carries several sizes as a `Size` option (consolidated product), just set **Print profile**; each
variant picks its size from the profile's `sizes` list by matching dimensions. Use a variant **Print spec override**
only when a variant's option text has no dimensions.

## Add a new size (print spec)

Content → Metaobjects → Print spec → Add entry. Fill trim width/height in inches, bleed per side, safe inset,
min/recommended DPI (flat print 150/300; large format 100/150), sides, formats, mode. For folded pieces add
`panels` as a JSON list of panel widths, e.g. `[3.6823, 3.6823, 3.6354]`. Customer-facing `notes` are optional.

## Add a new family (print profile)

Content → Metaobjects → Print profile → Add entry: name, mode, formats, a short customer guidance text
(e.g. sleeve/pole-pocket clearance for flags), optional template file, the list of sizes and a default size.

Keep supplier names and links out of these fields: everything here is public on the storefront.

## Current data

Loaded from `print-specs.json`: 199 print specs, 54 print profiles (one per product line), all 199 products
assigned. Bulk updates are done with `metaobjectUpsert` (handles = slug of the line key) and `metafieldsSet`.
