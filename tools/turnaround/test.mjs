// Harness tests for the turnaround selector (liquid render + pure JS). Not part of the theme.
import assert from 'assert/strict';
import fs from 'fs';
import { makeEngine } from './render.mjs';
const REPO = process.env.REPO || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('PASS', name); };

const FEE_FLAT = { id: 900, title: 'Rush Production', handle: 'rush-production', variants: [
  { id: 901, sku: 'RUSH-2BD', price: 1, available: true }, { id: 902, sku: 'RUSH-NBD', price: 1, available: true }, { id: 903, sku: 'RUSH-NBD-FLAT', price: 500, available: true }] };
const FEE_PENNY = { id: 900, title: 'Rush Production', handle: 'rush-production', variants: [
  { id: 901, sku: 'RUSH-2BD', price: 1, available: true }, { id: 902, sku: 'RUSH-NBD', price: 1, available: true }] };
const product = (tmeta, extra = {}) => ({ id: 1, title: 'Brochures', handle: 'brochures', url: '/products/brochures', has_only_default_variant: false,
  options_with_values: [{ name: 'Size', values: ['8.5x11'] }, { name: 'Qty', values: ['100', '1000'] }, { name: 'Config', values: ['GB100-44-AQ-HALF', 'GB100-44-AQ-TRI'] }],
  metafields: { printr: { turnaround: tmeta ? { value: tmeta } : null }, custom: {} }, ...extra });
const variant = (qty = '100', cfg = 'GB100-44-AQ-HALF', mf = {}) => ({ id: 777, title: `8.5x11 / ${qty} / ${cfg}`, price: 16900, options: ['8.5x11', qty, cfg], metafields: { printr: { rush_2bd: mf.r2 ? { value: mf.r2 } : null, rush_nbd: mf.rn ? { value: mf.rn } : null, standard_days: null } } });
async function render(p, v, { fee = FEE_FLAT, lang = 'en', blockText = '' } = {}) {
  const engine = makeEngine(lang);
  engine.registerFilter('json', (x) => JSON.stringify(x === undefined ? null : x));
  const tpl = `{% render 'rush-turnaround', product: product, variant: variant, section_id: 'main', block: block %}`;
  const globals = { settings: { rush_product: fee, rush_standard_days: 4 }, all_products: {}, shop: { money_format: '${{amount}}' }, request: { design_mode: false } };
  return engine.parseAndRender(tpl, { product: p, variant: v, block: { settings: { text: blockText } } }, { globals });
}
const data = (html) => JSON.parse(html.match(/data-rush-data>([\s\S]*?)<\/script>/)[1]);
const LAYERED = { v: 1, tiers: [{ k: '2bd', days: 2, fee: 0, default: true }, { k: 'nbd', days: 1, fee: 5, only: [{ o: 'Qty', v: ['100', '250', '500'] }] }] };

await t('2nd Day default + Next Day +$5 (flat variant)', async () => {
  const h = await render(product(LAYERED), variant('100'));
  const d = data(h);
  assert.equal(d.mode, 'product'); assert.equal(d.defaultTier, '2bd');
  assert.deepEqual(d.tiers.map((x) => x.k), ['2bd', 'nbd']);
  const nbd = d.tiers[1]; assert.deepEqual({ c: nbd.cents, fee: nbd.fee, u: nbd.units, f: nbd.flat }, { c: 500, fee: 903, u: 1, f: true });
  assert.match(h, /value="2bd" data-rush-opt checked/); assert.doesNotMatch(h, /value="nbd" data-rush-opt checked/);
  assert.match(h, />2nd Day</); assert.match(h, />Next Day</); assert.match(h, /\+\$5\.00/); assert.match(h, /Included/);
});
await t('without the flat variant, falls back to the $0.01 variant x 500 units', async () => {
  const d = data(await render(product(LAYERED), variant('100'), { fee: FEE_PENNY }));
  const nbd = d.tiers[1]; assert.deepEqual({ fee: nbd.fee, u: nbd.units, f: nbd.flat }, { fee: 902, u: 500, f: true });
});
await t('Next Day hidden when the spec does not offer it (qty 1000): plain 2 business days line', async () => {
  const h = await render(product(LAYERED), variant('1000'));
  assert.doesNotMatch(h, /<rush-turnaround/); assert.match(h, /Production time:<\/strong> 2 business days/);
});
await t('4-day-only product shows a plain line', async () => {
  const h = await render(product({ v: 1, tiers: [{ k: 'std', days: 4, fee: 0 }] }), variant());
  assert.doesNotMatch(h, /<rush-turnaround/); assert.match(h, /Production time:<\/strong> 4 business days/);
});
await t('Next-Day-only (shipping-included flyers): plain Next business day line', async () => {
  const h = await render(product({ v: 1, tiers: [{ k: 'nbd', days: 1, fee: 0 }] }), variant());
  assert.match(h, /Production time:<\/strong> Next business day/);
});
await t('Rush Production fee product missing: paid tier hidden', async () => {
  const h = await render(product(LAYERED), variant('100'), { fee: null });
  assert.doesNotMatch(h, /<rush-turnaround/); assert.match(h, /2 business days/);
});
await t('prefix + not conditions per Config', async () => {
  const m = { v: 1, tiers: [{ k: 'std', days: 4, fee: 0, default: true }, { k: 'nbd', days: 1, fee: 5, prefix: [{ o: 'Config', v: ['GB100-44-AQ-HALF'] }], not: [{ o: 'Qty', v: ['1000'] }] }] };
  assert.deepEqual(data(await render(product(m), variant('100', 'GB100-44-AQ-HALF'))).tiers.map((x) => x.k), ['std', 'nbd']);
  assert.doesNotMatch(await render(product(m), variant('100', 'GB100-44-AQ-TRI')), /<rush-turnaround/);
  assert.doesNotMatch(await render(product(m), variant('1000', 'GB100-44-AQ-HALF')), /<rush-turnaround/);
});
await t('Spanish labels', async () => {
  const h = await render(product(LAYERED), variant('100'), { lang: 'es' });
  assert.match(h, />Segundo día</); assert.match(h, />Próximo día</); assert.match(h, /Incluido/);
});
await t('legacy variant metafields still work (Standard default, per unit)', async () => {
  const d = data(await render(product(null), variant('100', 'x', { r2: 10, rn: 20 })));
  assert.equal(d.mode, 'variant'); assert.equal(d.defaultTier, 'standard');
  assert.deepEqual(d.tiers.map((x) => [x.k, x.cents, x.flat]), [['standard', 0, false], ['2bd', 1000, false], ['nbd', 2000, false]]);
});
await t('no metafields, blank text: renders nothing; with text: static line', async () => {
  assert.equal((await render(product(null), variant())).replace(/<style>[\s\S]*<\/style>/, '').trim(), '');
  assert.match(await render(product(null), variant(), { blockText: '5–7 business days' }), /5–7 business days/);
});

// ---- pure JS: formdata + cart reconciliation ----
globalThis.HTMLElement = class {}; globalThis.customElements = { get: () => null, define: () => {} };
const mod = await import(`${REPO}/assets/rush-turnaround.js`);
const mk = (qty = '1') => { const fd = new FormData(); fd.append('id', '777'); fd.append('quantity', qty); fd.append('properties[Size]', '8.5x11'); fd.append('properties[Turnaround]', 'Next business day'); return fd; };
const D = (await render(product(LAYERED), variant('100'))); const dat = data(D); dat.variant = 777; dat.title = 'Brochures'; dat.variantTitle = '8.5x11 / 100'; dat.standardDays = 4;
await t('default tier: records "2nd Day" property, adds no fee line', () => {
  const fd = mk(); const r = mod.applyRushToFormData(fd, dat, '2bd', ['Turnaround']);
  assert.equal(r.added, false); assert.equal(fd.get('properties[Turnaround]'), '2nd Day (2 business days)'); assert.equal([...fd.keys()].filter((k) => k.startsWith('items')).length, 0);
});
await t('Next Day: nested flat fee line qty 1 ($5.00 variant), parent properties set', () => {
  const fd = mk('1'); const r = mod.applyRushToFormData(fd, dat, 'nbd');
  assert.equal(r.added, true);
  assert.equal(fd.get('items[0][properties][Turnaround]'), 'Next Day (next business day)');
  assert.equal(fd.get('items[1][id]'), '903'); assert.equal(fd.get('items[1][quantity]'), '1'); assert.equal(fd.get('items[1][parent_id]'), '777');
  assert.equal(fd.get('items[0][properties][_rush_flat]'), '1'); assert.equal(fd.get('items[0][properties][_rush_units]'), '1');
  assert.equal(fd.get('items[0][properties][_rush_link]'), fd.get('items[1][properties][_rush_link]'));
});
await t('Next Day with print quantity 3 stays a flat fee (not x3)', () => {
  const fd = mk('3'); mod.applyRushToFormData(fd, dat, 'nbd'); assert.equal(fd.get('items[1][quantity]'), '1');
  const penny = JSON.parse(JSON.stringify(dat)); penny.tiers[1].fee = 902; penny.tiers[1].units = 500;
  const fd2 = mk('3'); mod.applyRushToFormData(fd2, penny, 'nbd'); assert.equal(fd2.get('items[1][quantity]'), '500');
});
await t('legacy per-unit tier still multiplies by print quantity', () => {
  const leg = { variant: 777, title: 'x', variantTitle: '', standardDays: 4, mode: 'variant', defaultTier: 'standard', tiers: [{ k: 'standard', days: 4, cents: 0, fee: 0, units: 0, flat: false }, { k: 'nbd', days: 1, cents: 382, fee: 902, units: 382, flat: false }] };
  const fd = mk('3'); mod.applyRushToFormData(fd, leg, 'nbd'); assert.equal(fd.get('items[1][quantity]'), String(382 * 3)); assert.equal(fd.get('items[0][properties][Turnaround]'), 'Next Business Day (rush)');
  const fd2 = mk('1'); mod.applyRushToFormData(fd2, leg, 'standard'); assert.equal(fd2.get('properties[Turnaround]'), 'Standard (4 business days)');
});
const src = fs.readFileSync(`${REPO}/assets/theme.js`, 'utf8');
const body = src.slice(src.indexOf('// RUSH-PLAN-START'), src.indexOf('// RUSH-PLAN-END'));
const { rushPlan } = new Function(`${body}; return { rushPlan };`)();
const parentFlat = (key, link, qty = 1) => ({ key, quantity: qty, product_title: 'Brochures', variant_title: '8.5x11 / 100', properties: { Turnaround: 'Next Day', _rush_link: link, _rush_tier: 'nbd', _rush_cents: '500', _rush_flat: '1', _rush_units: '1', _rush_fee_variant: '903' } });
const feeLine = (key, link, qty) => ({ key, quantity: qty, properties: { _rush_link: link, _rush_fee: 'nbd' } });
await t('cart: flat fee stays qty 1 when print qty changes to 4', () => assert.deepEqual(rushPlan({ items: [parentFlat('a', 'L1', 4), feeLine('f', 'L1', 1)] }), { updates: {}, adds: [] }));
await t('cart: flat fee edited by hand is restored to 1; missing fee re-added with qty 1', () => {
  assert.deepEqual(rushPlan({ items: [parentFlat('a', 'L1'), feeLine('f', 'L1', 5)] }).updates, { f: 1 });
  const p = rushPlan({ items: [parentFlat('a', 'L1', 2)] }); assert.equal(p.adds[0].quantity, 1); assert.equal(p.adds[0].id, 903);
});
console.log(`${n} passed`);
