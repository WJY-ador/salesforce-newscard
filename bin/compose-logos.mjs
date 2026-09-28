#!/usr/bin/env node
/**
 * 생성된 카드 PNG 위에 제품 로고를 얹는다 (2026-09-17 신설).
 *
 *   node bin/compose-logos.mjs --brief content/briefs/<name>.json
 *
 * 왜 따로 합성하나: GPT Image 는 로고를 못 그린다. 우리 카드에서 한글 낱글자도 7건 틀렸고,
 * NVIDIA·Siemens 같은 마크를 그리게 하면 "비슷하지만 틀린" 가짜가 나온다 — 뉴스 카드에서
 * 가짜 로고는 없느니만 못하다. 그래서 형태가 보장된 실물 SVG(assets/logo/)를 코드가 얹는다.
 *
 * 좌표를 어떻게 맞추나: GPT 가 어디에 무엇을 그렸는지 우리는 모른다. 그래서 반대로 한다 —
 * 프롬프트가 캔버스 하단의 고정 밴드(LOGO_BAND)를 "완전히 비워라"고 지시하고, 여기서 그
 * 같은 밴드에 로고를 균등 배치한다. 좌표가 양쪽 다 상수라 어긋날 수 없다.
 *
 * 색: assets/logo/index.json 의 color 가 "accent" 면 카드 강조색 단색(2색 규율 유지),
 * "brand" 면 brandHex 를 쓴다(제3색이 들어온다 — 의도적으로 바꿀 때만).
 *
 * 멱등이다. 이미 합성된 PNG 를 다시 돌려도 같은 결과가 나온다 — 원본을 .raw.png 로 남기고
 * 항상 그 원본에서 합성한다.
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
const { CANVAS, LOGO_SLOT } = require(resolve(ROOT, 'templates/card-layout.js'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BRIEF = opt('--brief');
if (!BRIEF) {
  console.error('사용법: node bin/compose-logos.mjs --brief content/briefs/<name>.json');
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

// 원본 보존 — 재실행해도 로고 위에 로고가 겹치지 않는다.
// 단 "있으면 안 덮는다"로 두면 안 된다 (2026-09-17 실측): generate-card.sh 가 카드를 새로
// 생성해 target 을 갈아끼워도 옛 .raw.png 가 남아 있어 그걸로 합성해, 새 생성물을 통째로
// 버렸다 — 재생성해도 같은 오타가 그대로 나왔다. target 이 raw 보다 새로우면 갓 생성된
// 것이므로 raw 를 갱신한다. 이미 합성된 PNG 를 다시 돌릴 때는 raw 가 더 새로워 그대로 쓴다.
const raw = target.replace(/\.png$/, '.raw.png');
const fresh = !existsSync(raw) || statSync(target).mtimeMs > statSync(raw).mtimeMs;
if (fresh) copyFileSync(target, raw);
// 합성을 끝내면 target 의 mtime 을 raw 에 맞춘다(아래 finally). 그렇게 하지 않으면 합성 직후
// 언제나 target > raw 라, 이 스크립트를 다시 돌릴 때마다 "새로 생성됐다"고 오판해 합성본을
// 원본으로 복사하고 그 위에 로고를 또 얹는다 — 라벨이 두 겹으로 찍혔다(2026-09-18 실측).

// 강조색 hex. 이벤트 팔레트가 있으면 그 hex.strong, 없으면 의미색 표에서 찾는다.
// card-layout.js 의 ACCENTS 는 GPT 프롬프트용 **색 이름**이라 hex 가 없다 — 합성에는
// 실제 값이 필요해 여기서만 따로 둔다. 이름이 바뀌면 여기도 같이 고쳐야 한다.
const ACCENT_HEX = {
  removed: '#a01b2d', enforced: '#b56a00', default: '#0b3d91', changed: '#0f6b6b', event: '#5b21b6'
};
function accentHex() {
  const card = brief.card;
  if (card.palette) {
    try {
      const p = JSON.parse(readFileSync(resolve(ROOT, 'content/palettes.json'), 'utf8'));
      const hit = p.palettes && p.palettes[card.palette];
      if (hit && hit.hex && hit.hex.ink) return hit.hex.ink;   // 로고는 잉크색이 읽기 좋다
    } catch (_) {}
  }
  return ACCENT_HEX[card.accent] || ACCENT_HEX.default;
}

// 원색이냐 단색이냐 (2026-09-18). brand 모드에서는 색이 SVG 안에 들어 있는 다색 원본을
// 그대로 쓴다 — fill 을 덮어쓰면 Slack 4색이 한 색으로 뭉개진다. 다색 원본이 없는 로고만
// 단색 패스를 brandHex 로 칠한다. accent 모드는 전부 카드 강조색으로 칠한다(2색 규율).
const brandMode = table.color === 'brand';
const labelColor = brandMode ? '#5b6472' : accentHex();
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
  // 위키미디어 원본은 width/height 가 박혀 있어 CSS 로 못 줄인다 — 벗겨서 viewBox 만 남긴다.
  svg = svg.replace(/<svg([^>]*)>/, (m, attrs) => '<svg' + attrs.replace(/\s(width|height)="[^"]*"/g, '') + '>');
  // 워드마크는 회사명이 마크 안에 있다 — 라벨을 또 달면 같은 글자가 두 번 찍힌다.
  const label = (useColor && meta.wordmark) ? '' : `<span>${meta.label}</span>`;
  return `<div class="cell"><div class="mark">${svg}</div>${label}</div>`;
}).join('');

// 헤더 우상단 슬롯 (2026-09-18). 전폭 하단 밴드에서 옮겼다 — 아래 주석 참조.
const slotTop = Math.round(LOGO_SLOT.top * CANVAS.height);
const slotHeight = Math.round(LOGO_SLOT.height * CANVAS.height);
const slotRight = Math.round(LOGO_SLOT.right * CANVAS.width);
const slotWidth = Math.round(LOGO_SLOT.maxWidth * CANVAS.width);
const bg = 'data:image/png;base64,' + readFileSync(raw).toString('base64');

const html = `<!doctype html><html><body>
<div id="card"><img id="bg" src="${bg}"><div id="strip">${cells}</div></div>
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  body { background:#fff }
  #card { position:relative; width:${CANVAS.width}px; height:${CANVAS.height}px; overflow:hidden }
  #bg { width:100%; height:100%; display:block }
  /* 우상단 슬롯 — 오른쪽 끝에 붙이고 왼쪽으로 자란다. 프롬프트가 비워 둔 영역과 같은 상수다. */
  #strip { position:absolute; right:${slotRight}px; top:${slotTop}px;
           height:${slotHeight}px; max-width:${slotWidth}px;
           display:flex; align-items:center; justify-content:flex-end; gap:${Math.round(slotHeight * 0.45)}px }
  .cell { display:flex; align-items:center }
  .mark { height:${slotHeight}px; display:flex; align-items:center }
  /* 높이를 px 로 못 박는다. width/height 를 벗긴 SVG 는 고유 크기가 없어, flex 안에서
     height:auto 로 두면 0 으로 접혀 마크가 통째로 사라진다(2026-09-18 실측). */
  .mark svg { height:${slotHeight}px; width:auto;
              max-width:${Math.round(slotWidth / 3)}px; display:block }
  /* 라벨은 그리지 않는다 — 슬롯이 작아 마크 아래 글자를 넣으면 둘 다 읽히지 않는다. */
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
// mtime 동기화 — 위 주석 참조. generate-card.sh 가 새 PNG 를 덮으면 그때만 target 이 더 새로워진다.
const rawTime = statSync(raw).mtime;
utimesSync(target, rawTime, rawTime);
console.log(`✓ 로고 ${slugs.length}개 합성 → ${brief.image.assetPath}  (원본: ${raw.split('/').pop()})`);
console.log(`  슬롯 우상단 y ${slotTop}~${slotTop + slotHeight}px · 최대폭 ${slotWidth}px — 프롬프트도 같은 상수로 이 자리를 비운다`);
