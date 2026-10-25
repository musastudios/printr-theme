// Flat Flyers: builds configurator JSON (custom.configurator) and the productSet payload.
// Usage: node tools/flat-flyers/generate.mjs  -> writes config.json, product-set.json, supplier-refs.csv
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const pub = new Set(readFileSync(dir + 'public-codes.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
const L = (en, es) => ({ en, es: es ?? en });
const SIZES = [['4x6', 4, 6], ['4.25x11', 4.25, 11], ['5.5x8.5', 5.5, 8.5], ['6x9', 6, 9], ['8.5x11', 8.5, 11], ['8.5x14', 8.5, 14], ['11x17', 11, 17], ['12x18', 12, 18]];
const QTY = [100, 250, 500, 1000, 2500, 5000];
const CS = ['40', '44', '41'];
// stock -> allowed coatings
const STOCK = { GB100: ['AQ', 'UV'], GC100: ['SAT'], MB100: ['NC'] };
const sizeOk = (size, stock, coat) => (size === '4x6' ? stock !== 'GC100' : size === '6x9' ? stock === 'GC100' : true);
// Supplier reference parts (inferred from the supplier's public flat-flyer code list; only 100GLB-FLUV-11X17-C-44-UV-NF portal-verified)
const REF_STOCK = { GB100: '100GLB', GC100: '100GLC', MB100: '100MB' };
const REF_FL = { AQ: 'FLAQ', UV: 'FLUV', SAT: 'FLSA', NC: 'FLUC' };
const REF_COAT = { AQ: 'AQ', UV: 'UV', SAT: 'CC-SA', NC: 'UC' };
function supplierRef(size, stock, cs, coat) {
  const base = `${REF_STOCK[stock]}-${REF_FL[coat]}-${size.toUpperCase()}-C-${cs}-${REF_COAT[coat]}`;
  const nhp = `${base}-NHP-NF`;
  const code = size === '8.5x11' && pub.has(nhp) ? nhp : `${base}-NF`;
  return { ref: `flat-flyers-brochures-${code}`, inPublicList: pub.has(code), verified: code === '100GLB-FLUV-11X17-C-44-UV-NF' };
}
// cost x2 from portal export (4/4 only for now; 4/0 and 4/1 stay $0 = quote)
const CSV_STOCK = { '100LB Gloss Book|Aqueous': 'GB100-44-AQ', '100LB Gloss Book|UV': 'GB100-44-UV', '100LB Gloss Cover|Satin': 'GC100-44-SAT', '100LB Matte Book|None': 'MB100-44-NC' };
const PORTAL = new Map();
readFileSync(dir + 'portal-prices-44.csv', 'utf8').trim().split('\n').slice(1).forEach((l) => { const [sku, size, stock, coat, , qty, , p2] = l.split(','); PORTAL.set(`${size}|${CSV_STOCK[`${stock}|${coat}`]}|${qty}`, { p: Number(p2), sku }); });
// Matte Book starts at 500
const qtyOk = (stock, q) => !(stock === 'MB100' && q < 500);

const configs = [];
for (const [size] of SIZES) for (const stock of Object.keys(STOCK)) for (const coat of STOCK[stock]) for (const cs of CS)
  if (sizeOk(size, stock, coat)) configs.push({ size, stock, cs, coat, code: `${stock}-${cs}-${coat}` });

const config = {
  version: 1, product: 'flat-flyers', currency: 'USD', markup: 2,
  title: L('Flat Flyers', 'Volantes'),
  options_map: { size: 'Size', qty: 'Qty', config: 'Config' },
  config_code: ['stock', 'colorspec', 'coating'],
  groups: [
    { key: 'size', label: L('Size', 'Tamaño'), values: SIZES.map(([v, w, h]) => ({ v, label: L(`${w}" × ${h}"`), trim: [w, h] })) },
    { key: 'stock', label: L('Paper', 'Papel'), values: [
      { v: 'GB100', label: L('100lb Gloss Book', 'Gloss Book 100 lb') },
      { v: 'GC100', label: L('100lb Gloss Cover', 'Gloss Cover 100 lb') },
      { v: 'MB100', label: L('100lb Matte Book', 'Matte Book 100 lb') }] },
    { key: 'colorspec', default: '44', label: L('Print colors', 'Colores de impresión'), values: [
      { v: '40', label: L('4/0 · Full color front, blank back', '4/0 · Color al frente, dorso en blanco'), sides: 1 },
      { v: '44', label: L('4/4 · Full color both sides', '4/4 · Full color ambos lados'), sides: 2 },
      { v: '41', label: L('4/1 · Full color front, black back', '4/1 · Color al frente, dorso en negro'), sides: 2 }] },
    { key: 'coating', label: L('Coating', 'Acabado'), values: [
      { v: 'AQ', label: L('Aqueous', 'Aqueous (brillo protector)') },
      { v: 'UV', label: L('UV (high gloss)', 'UV (alto brillo)') },
      { v: 'SAT', label: L('Satin', 'Satinado') },
      { v: 'NC', label: L('No coating', 'Sin acabado') }] },
  ],
  qty: QTY,
  rules: [
    { id: 'no-gc100-on-4x6', when: { size: ['4x6'] }, excludes: { stock: ['GC100'] }, reason: L('Not available at this size', 'No disponible en este tamaño') },
    { id: '6x9-gc100-only', when: { size: ['6x9'] }, only: { stock: ['GC100'] }, reason: L('Only Gloss Cover at this size', 'Solo Gloss Cover en este tamaño') },
    { id: 'gb100-coatings', when: { stock: ['GB100'] }, only: { coating: ['AQ', 'UV'] }, reason: L('Not available for this paper', 'No disponible para este papel') },
    { id: 'gc100-coatings', when: { stock: ['GC100'] }, only: { coating: ['SAT'] }, reason: L('Not available for this paper', 'No disponible para este papel') },
    { id: 'mb100-min-500', when: { stock: ['MB100'] }, excludes: { qty: ['100', '250'] }, reason: L('Matte starts at 500', 'Mate desde 500') },
    { id: 'mb100-coatings', when: { stock: ['MB100'] }, only: { coating: ['NC'] }, reason: L('Not available for this paper', 'No disponible para este papel') },
  ],
  turnarounds: [
    { v: 'STD', days: 7, default: true, label: L('Standard · 7 business days', 'Estándar · 7 días laborables') },
    { v: 'RUSH', days: 4, label: L('Rush · 4 business days (price confirmed by quote)', 'Rush · 4 días laborables (precio por cotización)') },
  ],
  addons: [
    { key: 'job_sample', type: 'builtin', label: L('Job sample', 'Muestra del trabajo'), price: 9.99, note: 'Existing data-bc-sample checkbox; line property.' },
    { key: 'digital_proof', type: 'builtin', label: L('Digital proof (Pre-flight & QA)', 'Prueba digital (Pre-flight y QA)'), price: 5, note: 'Existing data-bc-proof / uploader QA; line property.' },
    { key: 'hole3', type: 'option', when: { size: ['8.5x11'] }, label: L('3-hole punch', 'Perforación de 3 hoyos'), price: null, note: 'Line property only; priced on confirmation.' },
  ],
  uploader: { mode: 'flat', panels: 1, bleed_in: 0.125, dpi: 300, color: 'CMYK', sides_from: 'colorspec' },
  prices: {},
};
const variants = []; const csv = ['size,config,qty,price,supplier_ref,in_public_list,portal_verified'];
for (const c of configs) {
  const k = `${c.size}|${c.code}`; config.prices[k] = {};
  const r0 = supplierRef(c.size, c.stock, c.cs, c.coat);
  QTY.forEach((q) => {
    if (!qtyOk(c.stock, q)) return;
    const pr = PORTAL.get(`${k}|${q}`); const real = !!pr; const p = real ? pr.p : 0;
    const r = real ? { ref: pr.sku, inPublicList: r0.inPublicList, verified: true } : r0;
    if (real && pr.sku !== r0.ref) throw new Error(`ref mismatch ${k} ${q}`);
    config.prices[k][q] = { p: real ? p : null, src: real ? 'real' : 'placeholder' };
    variants.push({ optionValues: [{ optionName: 'Size', name: c.size }, { optionName: 'Qty', name: String(q) }, { optionName: 'Config', name: c.code }],
      price: p.toFixed(2), inventoryPolicy: 'CONTINUE', inventoryItem: { tracked: false, requiresShipping: true },
      sku: `FLY-${c.size.toUpperCase()}-${c.code}-${q}`,
      metafields: [{ namespace: 'custom', key: 'supplier_ref', type: 'single_line_text_field', value: r.ref }] });
    csv.push([c.size, c.code, q, p, r.ref, r.inPublicList, r.verified].join(','));
  });
}
const uniq = (a) => [...new Set(a)];
const input = { title: 'Flat Flyers', handle: 'flat-flyers', status: 'DRAFT', templateSuffix: 'flat-flyers', tags: ['needs-price', 'configurator'], vendor: 'PRINTR',
  productOptions: [{ name: 'Size', values: uniq(configs.map((c) => c.size)).map((name) => ({ name })) }, { name: 'Qty', values: QTY.map((q) => ({ name: String(q) })) }, { name: 'Config', values: uniq(configs.map((c) => c.code)).map((name) => ({ name })) }],
  variants };
writeFileSync(dir + 'config.json', JSON.stringify(config));
writeFileSync(dir + 'product-set.json', JSON.stringify(input));
writeFileSync(dir + 'supplier-refs.csv', csv.join('\n') + '\n');
console.log({ configs: configs.length, variants: variants.length, configJsonBytes: JSON.stringify(config).length });
