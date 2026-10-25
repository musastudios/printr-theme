# Reglas para configurar productos de impresión

Guía paso a paso para crear productos configurables (brochures primero; luego tarjetas de presentación y otros). Regla white‑label: en este repo y en la tienda se dice siempre **"el proveedor"**; nunca se escribe su marca.

Archivos de referencia (rama `feature/brochure-configurator`):
- `assets/brochure-configurator.js` — motor del configurador y adaptadores.
- `snippets/brochure-configurator.liquid` — markup, datos JSON y re-fetch de sección.
- `templates/product.brochures.json` — plantilla de producto.
- `tools/brochures/generate.mjs` — generador de variantes.
- `docs/brochure-configurator.md`, `docs/print-profiles.md` — documentación detallada.
- Metaobjetos `print_profile` / `print_spec` y metafield `custom.configurator`.

## 1. Mapear las opciones del proveedor a Shopify
1. Selectores visibles al cliente, separados: **Tamaño, Papel (Stock), Color (Color spec), Recubrimiento (Coating), Doblez (Folding) y Cantidad**.
2. Opciones Shopify: `Size | Qty | Config`. `Config` es oculta y empaqueta papel+color+recubrimiento+doblez, p. ej. `GB100-44-AQ-TRI`.
3. Cantidad se muestra como filas de radio construidas desde la tabla de precios.
4. Dependencias con la lista de reglas (`excludes` / `only`) en `custom.configurator`. Ejemplos:
   - 80lb Gloss Book: solo Aqueous o None.
   - Dull: solo Satin.
   - Matte/Opaque: sin recubrimiento.
   - Algunos dobleces solo permiten ciertos tamaños (`only`).

## 2. Variantes
1. Presupuesto: `tamaños × cantidades × configs ≤ 2048`; apuntar a **~1,800** para dejar margen.
2. Generarlas con `node tools/brochures/generate.mjs` — seguimiento de inventario **OFF**, `inventoryPolicy: CONTINUE`.
3. Si se excede el presupuesto:
   - Dividir el producto por papel (un producto por stock), o
   - Variantes bajo demanda vía un Worker: el configurador calcula el `Config`, el Worker crea la variante (precio = costo × 2) si no existe y devuelve su ID para agregar al carrito; se limpian las no usadas periódicamente. (No hay `DYNAMIC_VARIANTS_FEASIBILITY.md` en el repo todavía.)

## 3. Perfil del uploader por producto
1. Metaobjetos `print_profile` / `print_spec` (ver `docs/print-profiles.md`, `snippets/print-spec-json.liquid`).
2. Caras desde el color spec: `4/0` = 1 cara (solo frente); `4/4`, `4/1` = 2 caras (frente/dorso).
3. Líneas de sangrado (bleed), corte (trim) y zona segura (safe); DPI mínimo.
4. Paneles de doblez: tríptico 3, díptico 2, plano 1 — se derivan del código `Config` (`-TRI`, `-HALF`, plano).

## 4. Etiquetas de color spec
| Código | Español | English |
|---|---|---|
| 4/0 | Color al frente, dorso en blanco | Full color front, blank back |
| 4/4 | Full color ambos lados | Full color both sides |
| 4/1 | Color al frente, dorso en negro | Full color front, black back |

## 5. Papel siempre visible
El selector de Stock se muestra siempre, aunque haya una sola opción.

## 6. Sin campo de Proyecto/PO
No mostrar campo "Project name" ni "PO" en la tienda.

## 7. Add-ons
- Muestra del trabajo (job sample): **$9.99**.
- Prueba digital (digital proof) = el add-on QA de **$5**.
- Productos ocultos de cargo (fee products): **pendientes hasta que Juan los apruebe**. Mientras tanto se guardan como nota de línea (line item property).

## 8. Patrón de adaptador intercambiable
Interfaz en `assets/brochure-configurator.js`: `getSchema()`, `getRules()`, `getPrice()`, `resolveVariant()`.
- Hoy: `StaticJsonAdapter` (JSON de `custom.configurator`).
- Futuro: `SupplierApiAdapter` (API del proveedor), misma interfaz; solo se cambia el adaptador.

## 9. Publicación
1. El producto queda en **DRAFT** hasta que toda variante tenga precio real (**costo × 2**).
2. Nunca publicar variantes en $0 (el configurador las trata como "cotizar").
3. Mientras falten precios: tag `needs-price` y metafield `custom.price_status`.

## 10. Flujo de trabajo
1. Rama feature → tema preview **no publicado** → Juan revisa → PR a `main` solo con el OK de Juan. `main` sincroniza con el tema live.
2. Nombrar la tienda antes de cualquier escritura (Admin API/CLI).
3. Nunca mostrar el nombre del proveedor al cliente (textos, metafields, notas, emails).
4. `shopify theme check` con **0** ofensas; nombres de bloques **≤ 25 caracteres**.

## 11. Trampa de Liquid
Nunca anidar `{{ }}` dentro de un string Liquid (p. ej. dentro de `| t` o `default:`). Usar un placeholder como `'__PCT__'` y reemplazarlo en JS. Theme check **no** lo detecta: probar el render en el preview.

## 12. Productos con muchas variantes
Seguir https://shopify.dev/docs/storefronts/themes/product-merchandising/variants/support-high-variant-products
- `product.variants` en Liquid devuelve solo **250**.
- El configurador usa `option_values` + `product_option_value` y re-fetch de sección: `?section_id=<id>&option_values=<ids>`.
- El precio se toma **solo de la variante** resuelta.

## 13. Checklist: agregar un producto nuevo
1. Nombrar la tienda; crear rama feature desde la rama vigente.
2. Listar opciones del proveedor (tamaño, papel, color, recubrimiento, doblez, cantidades) y su tabla de costos.
3. Escribir las reglas `excludes`/`only` y los códigos `Config`.
4. Calcular presupuesto de variantes (≤ 2048, meta ~1,800); si excede, dividir por papel o usar Worker.
5. Generar variantes con `tools/brochures/generate.mjs` (inventario OFF, CONTINUE), producto en DRAFT.
6. Cargar `custom.configurator` y crear/asignar `print_profile`/`print_spec`.
7. Asignar plantilla (`templates/product.brochures.json` o equivalente).
8. Revisar etiquetas de color (ES/EN), papel visible, sin campo PO, add-ons ($9.99 / $5 QA).
9. Precios = costo × 2; quitar `needs-price`, actualizar `custom.price_status`.
10. Theme check 0; probar render y carrito en el tema preview (incluido re-fetch de variantes).
11. Revisión de Juan → PR a `main` con su OK → publicar producto.
12. Orden: brochures → tarjetas de presentación → otros.
