#!/usr/bin/env node
/**
 * 행사 카드 전용 로고 합성기 — 4:5(1024x1280) 카드 위에 제품 로고를 얹는다 (2026-09-18 신설).
 *
 *   node bin/compose-logos-event.mjs --brief content/briefs/<name>.json
 *
 * 왜 형제 스크립트인가: bin/compose-logos.mjs 는 templates/card-layout.js 의 CANVAS(1024x1536)와
 * LOGO_SLOT 을 상수로 읽어 그 캔버스에만 그린다 — 좌표를 넘길 옵션이 없다(그 파일 헤더·33~39행 확인).
 * 행사 카드는 인스타 4:5 에 맞춰 1024x1280 으로 크롭해 내므로, 1536 기준 슬롯(y 25~77)은
 * 크롭되는 상단 128px 띠 안에 통째로 들어가 로고가 사라진다. Main 파이프라인의 행사 분기는
 * 동결이라(docs/event-newscard.SKILL.md 1절) compose-logos.mjs 를 고치지 않고 형제를 둔다.
 *
 * 좌표: 크롭된 1024x1280 캔버스에서 y 25~77px · 오른쪽 여백 4.5% · 최대폭 307px.
 * 크롭 전 원본(1024x1536)으로 치면 y 153~205px 이다 — 프롬프트는 그 자리를 비워 둔다.
 * 나머지(멱등 .raw.png · brand 원색 · width/height 벗기기 · 라벨 숨김)는 compose-logos.mjs 와 같다.
 */
import { readFileSync, existsSync, copyFileSync, statSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { CHROME, assertChrome } from './lib/chrome.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadBrief } = require(resolve(ROOT, 'templates/card-brief.js'));

// 행사 카드 캔버스 — 인스타 4:5. card-layout.js 의 CANVAS 를 쓰지 않는다(저기는 1536 고정).
const CANVAS = { width: 1024, height: 1280 };
const SLOT = { top: 25, height: 52, right: 46, maxWidth: 307 };   // px, 위 캔버스 기준

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BRIEF = opt('--brief');
if (!BRIEF) {
  console.error('사용법: node bin/compose-logos-event.mjs --brief content/briefs/<name>.json');
  process.exit(1);
}

const brief = loadBrief(readFileSync, resolve(ROOT, BRIEF));
const slugs = (brief.card && brief.card.logos) || [];
if (!slugs.length) {
  console.log('— card.logos 가 없습니다. 합성할 것이 없어 그대로 둡니다.');
  process.exit(0);
}

const table = JSON.parse(readFileSync(resolve(ROOT, 'assets/logo/index.json'), 'utf8'));
const target = resolve(ROOT, brief.image.assetPath);
if (!existsSync(target)) {
  console.error(`✗ 생성된 카드 PNG 가 없습니다: ${brief.image.assetPath}`);
  process.exit(1);
}

// 원본 보존 — 재실행해도 로고 위에 로고가 겹치지 않는다. target 이 raw 보다 새로우면 갓
// 생성(또는 갓 크롭)된 것이라 raw 를 갱신한다. 합성 뒤 mtime 을 raw 에 맞춰 되돌린다(아래).
const raw = target.replace(/\.png$/, '.raw.png');
const fresh = !existsSync(raw) || statSync(target).mtimeMs > statSync(raw).mtimeMs;
if (fresh) copyFileSync(target, raw);

const ACCENT_HEX = {
  removed: '#a01b2d', enforced: '#b56a00', default: '#0b3d91', changed: '#0f6b6b', event: '#5b21b6'
};
function accentHex() {
  const card = brief.card;
  if (card.palette) {
    try {
      const p = JSON.parse(readFileSync(resolve(ROOT, 'content/palettes.json'), 'utf8'));
      const hit = p.palettes && p.palettes[card.palette];
      if (hit && hit.hex && hit.hex.ink) return hit.hex.ink;
    } catch (_) {}
  }
  return ACCENT_HEX[card.accent] || ACCENT_HEX.default;
}

const brandMode = table.color === 'brand';
const cells = slugs.map(slug => {
  const meta = table.logos[slug];
  if (!meta) { console.error(`✗ assets/logo/index.json 에 없는 로고: ${slug}`); process.exit(1); }
  const useColor = brandMode && meta.color;
  const file = resolve(ROOT, `assets/logo/${useColor ? 'color' : 'mono'}/${slug}.svg`);
  if (!existsSync(file)) { console.error(`✗ 로고 SVG 가 없습니다: ${file.replace(ROOT + '/', '')}`); process.exit(1); }
  let svg = readFileSync(file, 'utf8');
  if (!useColor) {
    const color = brandMode ? (meta.brandHex || accentHex()) : accentHex();
    svg = svg.replace('<svg ', `<svg fill="${color}" `);
  }
  svg = svg.replace(/<svg([^>]*)>/, (m, attrs) => '<svg' + attrs.replace(/\s(width|height)="[^"]*"/g, '') + '>');
  const label = (useColor && meta.wordmark) ? '' : `<span>${meta.label}</span>`;
  return `<div class="cell"><div class="mark">${svg}</div>${label}</div>`;
}).join('');

const bg = 'data:image/png;base64,' + readFileSync(raw).toString('base64');

const html = `<!doctype html><html><body>
<div id="card"><img id="bg" src="${bg}"><div id="strip">${cells}</div></div>
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  body { background:#fff }
  #card { position:relative; width:${CANVAS.width}px; height:${CANVAS.height}px; overflow:hidden }
  #bg { width:100%; height:100%; display:block }
  #strip { position:absolute; right:${SLOT.right}px; top:${SLOT.top}px;
           height:${SLOT.height}px; max-width:${SLOT.maxWidth}px;
           display:flex; align-items:center; justify-content:flex-end; gap:${Math.round(SLOT.height * 0.45)}px }
  .cell { display:flex; align-items:center }
  .mark { height:${SLOT.height}px; display:flex; align-items:center }
  /* 높이를 px 로 못 박는다 — width/height 를 벗긴 SVG 는 고유 크기가 없어 height:auto 면 0 으로 접힌다. */
  .mark svg { height:${SLOT.height}px; width:auto;
              max-width:${Math.round(SLOT.maxWidth / 3)}px; display:block }
  .cell span { display:none }
</style></body></html>`;

assertChrome();
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: CANVAS.width, height: CANVAS.height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: target, clip: { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height } });
} finally {
  await browser.close();
}
const rawTime = statSync(raw).mtime;
utimesSync(target, rawTime, rawTime);
console.log(`✓ 로고 ${slugs.length}개 합성 → ${brief.image.assetPath}  (원본: ${raw.split('/').pop()})`);
console.log(`  슬롯 우상단 y ${SLOT.top}~${SLOT.top + SLOT.height}px / 캔버스 ${CANVAS.width}x${CANVAS.height} — 크롭 전 원본으로는 y ${SLOT.top + 128}~${SLOT.top + SLOT.height + 128}px`);
