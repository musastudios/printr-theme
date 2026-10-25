#!/usr/bin/env node
/**
 * Brochure configurator generator (OFFLINE ONLY — never runs against the store).
 *
 *   node tools/brochures/generate.mjs [outDir]
 *
 * Outputs:
 *   configurator.json      Public configurator JSON (retail prices = cost × MARKUP). Safe for the
 *                          product metafield custom.configurator or assets/brochure-configurator.json.
 *   product-payload.json   productSet-style payload: 1 product, options Size | Qty | Config, 432 variants.
 *   price-report.json      Which prices are REAL (portal cost sample) vs PLACEHOLDER.
 *
 * Pricing policy: only rows present in cost-samples.csv are "real". Every other combination is
 * "placeholder" with price null (variant payload marks it REQUIRES_PRICE); nothing is invented.
 * The storefront shows "Solicitar cotización" for null prices.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || join(here, 'out');
const MARKUP = 2;

const L = (en, es) => ({ en, es });
const groups = [
  { key: 'size', label: L('Size', 'Tamaño'), values: [
    { v: '11x17', label: L('11" × 17"', '11" × 17"'), trim: [11, 17] },
    { v: '5.5x8.5', label: L('5.5" × 8.5"', '5.5" × 8.5"'), trim: [5.5, 8.5] },
    { v: '8.5x11', label: L('8.5" × 11"', '8.5" × 11"'), trim: [8.5, 11] },
    { v: '8.5x14', label: L('8.5" × 14"', '8.5" × 14"'), trim: [8.5, 14] } ] },
  { key: 'stock', label: L('Paper', 'Papel'), values: [
    { v: 'GB100', label: L('100lb Gloss Book', 'Gloss Book 100 lb'), match: '100LB Gloss Book' } ] },
  { key: 'colorspec', default: '44', label: L('Print colors', 'Colores de impresión'), values: [
    { v: '40', label: L('4/0 · Full color front', '4/0 · Full color al frente'), sides: 1, match: '4/0' },
    { v: '44', label: L('4/4 · Full color both sides', '4/4 · Full color ambos lados'), sides: 2, match: '4/4' },
    { v: '41', label: L('4/1 · Color front, black back', '4/1 · Color al frente, negro atrás'), sides: 2, match: '4/1' } ] },
  { key: 'coating', label: L('Coating', 'Acabado'), values: [
    { v: 'AQ', label: L('Aqueous', 'Aqueous (brillo protector)'), match: 'Aqueous' },
    { v: 'NC', label: L('No coating', 'Sin acabado'), match: 'No Coating' } ] },
  { key: 'fold', label: L('Fold', 'Doblez'), values: [
    { v: 'TRI', label: L('Tri-fold / Letter fold', 'Tríptico (doblez carta)'), panels: 3, match: 'Tri-Fold/Letter Fold' },
    { v: 'FLAT', label: L('Flat (no folding)', 'Plano (sin doblez)'), panels: 1, match: 'Flat' },
    { v: 'HALF', label: L('Half-fold', 'Díptico (doblez a la mitad)'), panels: 2, match: 'Half-Fold' } ] }
];
const qty = [100, 250, 500, 1000, 2500, 5000];

// Rules: none observed in the portal yet. The engine supports `excludes` and `only`.
// Examples kept disabled ("enabled": false) to document the shape.
const rules = [
  { id: 'example-no-tri-on-5.5x8.5', enabled: false, when: { size: ['5.5x8.5'] }, excludes: { fold: ['TRI'] },
    reason: L('Tri-fold is not available at this size', 'El tríptico no está disponible en este tamaño') },
  { id: 'example-aq-requires-gb100', enabled: false, when: { coating: ['AQ'] }, only: { stock: ['GB100'] },
    reason: L('Aqueous coating requires 100lb Gloss Book', 'Aqueous requiere Gloss Book 100 lb') }
];

const configCode = (s) => `${s.stock}-${s.colorspec}-${s.coating}-${s.fold}`;
const find = (k, v) => groups.find((g) => g.key === k).values.find((x) => x.v === v);

// ---- cost samples ----
const csv = readFileSync(join(here, 'cost-samples.csv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
const head = csv.shift().split(',');
const samples = csv.map((l) => Object.fromEntries(l.split(',').map((c, i) => [head[i], c.trim()])));
const costOf = (sel, q) => {
  const hit = samples.find((r) => r.size === sel.size && r.stock === find('stock', sel.stock).match &&
    r.colorspec === find('colorspec', sel.colorspec).match && r.coating === find('coating', sel.coating).match &&
    r.fold.replace(/\s/g, '') === find('fold', sel.fold).match.replace(/\s/g, '') && Number(r.qty) === q);
  return hit ? Number(hit.cost_total) : null;
};

const prices = {}; const variants = []; const report = { real: [], placeholder_count: 0 };
for (const size of groups[0].values) for (const st of groups[1].values) for (const cs of groups[2].values)
  for (const co of groups[3].values) for (const fo of groups[4].values) {
    const sel = { size: size.v, stock: st.v, colorspec: cs.v, coating: co.v, fold: fo.v };
    const code = configCode(sel); const key = `${size.v}|${code}`; prices[key] = {};
    for (const q of qty) {
      const cost = costOf(sel, q);
      const price = cost == null ? null : Math.round(cost * MARKUP * 100) / 100;
      prices[key][q] = price == null ? { p: null, src: 'placeholder' } : { p: price, src: 'real' };
      if (price == null) report.placeholder_count++; else report.real.push({ key, qty: q, cost, price });
      variants.push({
        optionValues: [{ optionName: 'Size', name: size.v }, { optionName: 'Qty', name: String(q) }, { optionName: 'Config', name: code }],
        price: price == null ? 'REQUIRES_PRICE' : price.toFixed(2),
        sku: `BRO-${size.v.replace('.', '')}-${q}-${code}`,
        inventoryPolicy: 'CONTINUE', taxable: true,
        _price_source: price == null ? 'placeholder' : 'real'
      });
    }
  }

const config = {
  version: 1, product: 'brochures', currency: 'USD', markup: MARKUP,
  title: L('Brochures', 'Folletos'),
  options_map: { size: 'Size', qty: 'Qty', config: 'Config' },
  config_code: ['stock', 'colorspec', 'coating', 'fold'],
  groups: groups.map((g) => ({ ...g, values: g.values.map(({ match, ...v }) => v) })),
  qty, rules,
  turnaround: { v: 'NBD', label: L('Next business day', 'Próximo día laborable') },
  addons: [{ key: 'job_sample', label: L('Job sample', 'Muestra del trabajo'), price: 19.98, status: 'pending_approval',
    note: 'Maps to the existing QA/proof flow in the artwork uploader; not rendered as a separate fee.' }],
  prices
};
const product = {
  title: 'Folletos / Brochures', handle: 'brochures', status: 'DRAFT', productType: 'Brochures',
  productOptions: [
    { name: 'Size', values: groups[0].values.map((v) => ({ name: v.v })) },
    { name: 'Qty', values: qty.map((q) => ({ name: String(q) })) },
    { name: 'Config', values: [...new Set(variants.map((v) => v.optionValues[2].name))].map((name) => ({ name })) }
  ],
  metafields: [{ namespace: 'custom', key: 'configurator', type: 'json', value: '<configurator.json>' }],
  variants
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'configurator.json'), JSON.stringify(config, null, 1));
writeFileSync(join(outDir, 'product-payload.json'), JSON.stringify({ _note: 'DO NOT RUN without approval. REQUIRES_PRICE rows must be priced first.', product }, null, 1));
writeFileSync(join(outDir, 'price-report.json'), JSON.stringify({ ...report, total: variants.length }, null, 1));
console.log(`variants=${variants.length} configs=${product.productOptions[2].values.length} real=${report.real.length} placeholder=${report.placeholder_count} -> ${outDir}`);
