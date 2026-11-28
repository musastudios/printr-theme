// Render theme snippets with liquidjs (test harness only; not part of the theme). Run: cd tools/turnaround && npm i && npm test
import { Liquid, Tag } from 'liquidjs';
import fs from 'fs';
const REPO = process.env.REPO || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\s*\/\*[\s\S]*?\*\//, ''));
const locales = { en: rd(`${REPO}/locales/en.default.json`), es: rd(`${REPO}/locales/es.json`) };

export function makeEngine(lang = 'en') {
  const engine = new Liquid({ root: [`${REPO}/snippets`], extname: '.liquid', relativeReference: false, jsTruthy: false });
  class Skip extends Tag { constructor(t, r, l) { super(t, r, l); while (r.length) { const tok = r.shift(); if (tok.name === 'enddoc') return; } } *render() {} }
  class Style extends Tag { constructor(t, r, l) { super(t, r, l); this.raw = ''; while (r.length) { const tok = r.shift(); if (tok.name === 'endstylesheet') return; this.raw += tok.getText(); } } *render(ctx, emitter) { emitter.write(`<style>${this.raw}</style>`); } }
  engine.registerTag('doc', Skip);
  engine.registerTag('stylesheet', Style);
  engine.registerFilter('t', (key, ...args) => {
    let s = key.split('.').reduce((o, k) => (o ? o[k] : undefined), locales[lang]);
    if (s == null) return `translation missing: ${key}`;
    args.forEach((a) => { if (Array.isArray(a)) s = s.replace(new RegExp(`\\{\\{\\s*${a[0]}\\s*\\}\\}`, 'g'), a[1]); });
    return s;
  });
  engine.registerFilter('money', (c) => '$' + (Number(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  engine.registerFilter('asset_url', (n) => `/__local/${n}`);
  engine.registerFilter('image_url', () => '');
  engine.registerFilter('image_tag', () => '');
  return engine;
}
