# Flat Flyers (volantes planos)

Producto: `flat-flyers` · gid://shopify/Product/15424554008750 · DRAFT · plantilla `product.flat-flyers` · tags `needs-price`, `configurator`.
Generador: `node tools/flat-flyers/generate.mjs` → `config.json` (metafield `custom.configurator`), `product-set.json`, `supplier-refs.csv`.

## Variantes (462)
Opciones `Size | Qty | Config` (patrón Brochures: Config fusionado `STOCK-CS-COAT`).
- Tamaños: 4x6, 4.25x11, 5.5x8.5, 6x9, 8.5x11, 8.5x14, 11x17, 12x18 · Qty: 100–5000 (6).
- Config: GB100-{40,44,41}-{AQ,UV}, GC100-{cs}-SAT, MB100-{cs}-NC (12).
- Exclusiones: 4x6 sin GC100 (9 configs); 6x9 solo GC100-SAT (3). 6×12 + 9 + 3 = 84 configs × 6 = 504, menos 42 de Matte Book (MB100) en 100/250 (el papel empieza en 500; regla `mb100-min-500`) = 462.
- Inventario sin rastreo, política CONTINUE. Precio = costo × 2 del portal (`tools/flat-flyers/portal-prices-44.csv` y `portal-prices-40-41.csv`): las 462 variantes (4/4, 4/0 y 4/1) tienen precio real.

## Configurador
- Papel siempre visible; acabado depende del papel (reglas `only`). Sin doblez ni nombre de proyecto.
- `turnarounds`: Estándar 7 días (default) y Rush 4 días, sin precio; va a la propiedad de línea "Turnaround" y a `_spec.turnaround`.
- Add-ons: muestra $9.99 y prueba digital $5 (mecanismo existente, propiedades de línea). `hole3` (perforación 3 hoyos) tipo `option`, solo para 8.5x11, propiedad de línea sin precio.
- Uploader: perfil `flat-flyers-brochures` (flat, 1 panel, sangrado 0.125", 300 dpi CMYK); frente/dorso por colorspec (regex de `artwork-uploader.js` acepta códigos sin doblez).

## Referencia de proveedor (`custom.supplier_ref`, variante, sin acceso storefront)
Formato `flat-flyers-brochures-<STOCK>-<FLcoat>-<SIZE>-C-<CS>-<COAT>[-NHP]-NF`. Nunca se muestra en la tienda.
| Nuestro | STOCK | FLcoat | COAT |
|---|---|---|---|
| GB100 + AQ | 100GLB | FLAQ | AQ |
| GB100 + UV | 100GLB | FLUV | UV |
| GC100 + SAT | 100GLC | FLSA | CC-SA |
| MB100 + NC | 100MB | FLUC | UC |

8.5x11 usa `-NHP-NF` (sin perforar) cuando existe en la lista pública (no existe para 100GLB-FLAQ).
Verificadas en portal: todas las referencias 4/4 (28 códigos; coinciden 100% con el formato inferido). 4/0 y 4/1 (56 códigos) también verificadas con la exportación del portal.
