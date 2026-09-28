/**
 * 문서 페이지 캡처 + 빨간 네모 주석 — 예고 카드(Winter '27 예고 레인)의 evidence ① (2026-09-09 신설)
 *
 *   node bin/capture-docpage.mjs "<url>" "<찾을 문구>" <out.png>
 *
 * org 에 아직 안 온 릴리스 노트 항목을 카드로 낼 때, "우리가 읽은 원문이 이것"임을 화면으로
 * 남긴다. capture-annotated.mjs 와 같은 주석 방식(DOM outline 주입)이되 sf org open 을 타지
 * 않는다 — help.salesforce.com 은 로그인이 없다. 조회 전용.
 *
 * 매칭은 텍스트 노드에서 시작해 문단 크기(높이 20~260 · 폭 300~1300px) 조상으로 승격한다 —
 * 릴리스 노트 본문은 목록 카드가 아니라 문단이라 capture-annotated 의 120px 하한을 낮췄다.
 * 실측 2026-09-09: 하한 40px 이면 한 줄짜리 When 문단(약 30px)을 건너뛰어 article 전체가 잡혔다.
 * 쿠키 배너는 동의 버튼을 누르지 않고 DOM 에서 제거한다.
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './lib/chrome.mjs';

// 캡처 크기. 기본이 **세로형**이다 — `--viewport 1600x1100` 로 가로로 바꿀 수 있다
// (2026-09-15 전환). Instagram 슬라이드가 세로 3:4 라 가로로 넓은 캡처를 넣으면
// 글자가 읽을 수 없이 작아지고, 채우려고 좌우를 깎으면 화면이 토막 난다.
// 세로로 찍으면 같은 자리에서 글자가 커지고 좌우를 안 잘라도 된다. Slack 도 같은 파일을 쓴다.
const VP_ARG = (() => {
  const i = process.argv.indexOf('--viewport');
  if (i < 0) return null;
  const m = String(process.argv[i + 1] || '').match(/^(\d+)x(\d+)$/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
})();
const VIEWPORT = VP_ARG || { width: 1100, height: 1500 };

const [url, needle, out] = process.argv.slice(2);
if (!url || !needle || !out) {
  console.error('사용법: node bin/capture-docpage.mjs "<url>" "<찾을 문구>" <out.png>');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`]
});
try {
  const page = await browser.newPage();
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  // Aura SPA — 본문 문구가 실제로 그려질 때까지 기다린다 (needle 자체를 대기 조건으로).
  // 비교는 **공백을 접어서** 한다 — 원문 HTML 의 줄바꿈·들여쓰기가 노드 안에 그대로 남아
  // 그냥 includes 하면 멀쩡한 문구도 안 잡힌다 (2026-09-22 실측, 아래 matchNeedle 주석 참조).
  let rendered = true;
  await page.waitForFunction(
    t => {
      const n = s => s.replace(/\s+/g, ' ').trim();
      return n(document.body?.innerText || '').includes(n(t));
    },
    { timeout: 120000 }, needle
  ).catch(() => { rendered = false; });
  if (!rendered) {
    console.error(`본문에서 문구를 찾지 못했습니다(렌더 대기 120초 초과): "${needle}"`);
    console.error('  → 원문이 바뀌었거나 페이지 본문이 안 떴습니다. URL 과 문구를 먼저 확인하세요.');
    process.exit(2);
  }
  await new Promise(r => setTimeout(r, 2000));
  // 쿠키 배너·공통 알림 띠는 DOM 에서 치운다 — 동의 버튼을 누르지 않는다(가장 보수적인 선택)
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter, [class*="cookie" i], [id*="cookie" i]')) el.remove();
    for (const el of document.querySelectorAll('div, section')) {
      const t = (el.innerText || '').trim();
      if (t.length < 400 && /쿠키를 사용합니다|We use cookies|temporarily unavailable/.test(t) && el.getBoundingClientRect().height < 320) el.remove();
    }
  }).catch(() => {});

  // 문구가 걸린 요소를 찾는다. 텍스트 노드 우선, 못 찾으면 요소 innerText 로 내려간다.
  //
  // **왜 두 경로인가 (2026-09-22 실측)**: 종전에는 `n.textContent.includes(text)` 하나였는데,
  // textContent 는 공백을 접지 않아 원문 HTML 이 문장 중간에서 줄을 바꾸면 매칭이 깨진다.
  // 실측: rn_security_oauth_controls_new_apps 의 When 절이 화면에 멀쩡히 있는데
  // "created in July 2026 and later" · "currently enforced for apps that were created before
  // July 2026" 둘 다 "문구를 못 찾았습니다" 로 끝났다. 위 렌더 대기(innerText)는 통과했는데
  // 여기서만 실패해서, 원문이 바뀐 건지 도구가 못 찾은 건지 구분이 안 됐다.
  // 그래서 ① 비교를 전부 공백 정규화로 바꾸고 ② 실패 메시지를 렌더 실패와 매칭 실패로 갈랐다.
  const found = await page.evaluate(text => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const needleN = norm(text);
    const hits = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (norm(n.textContent).includes(needleN) && n.parentElement) hits.push(n.parentElement);
    if (!hits.length) {
      // 문구가 인라인 링크·강조 태그로 쪼개져 텍스트 노드 하나에 안 들어가는 경우.
      // 문구를 품은 **가장 작은** 요소를 고른다 — 위에서부터 찾으면 article 전체가 잡힌다.
      let best = null;
      for (const el of document.body.querySelectorAll('p, li, div, td, section, span')) {
        if (!norm(el.innerText).includes(needleN)) continue;
        if (!best || el.getBoundingClientRect().height <= best.getBoundingClientRect().height) best = el;
      }
      if (best) hits.push(best);
    }
    for (const start of hits) {
      let el = start, box = null;
      for (let i = 0; i < 8 && el; i++) {
        const r = el.getBoundingClientRect();
        if (r.height >= 20 && r.height <= 260 && r.width >= 300 && r.width <= 1300) { box = el; break; }
        if (r.width > 1300) break;
        el = el.parentElement;
      }
      if (!box) box = start;
      // 네모를 가리는 조상의 overflow 를 먼저 푼다.
      //
      // **실측 2026-09-22 (help.salesforce.com 릴리스 노트)**: outline 은 요소 바깥에
      // 그려지는데, 문단의 부모 `div.slds-text-longform` 이 `overflow: auto` 이고 문단
      // 폭이 그 안쪽 폭과 같아서 좌우 변(offset 6px + 선 6px = 바깥 12px)이 통째로
      // 잘렸다 — 위아래 선 두 개만 남아 증거 사진이 네모로 안 보였다.
      // 폭 상한(1300)·clip 범위를 손대는 것은 원인이 아니었다(둘 다 시도했고 그림이 그대로).
      // 음수 offset 으로 안쪽에 그리면 잘리진 않지만 첫 줄·끝 줄 글자를 먹는다.
      // overflow 를 visible 로 되돌리는 게 가장 깨끗하다 — 실제로 넘치는 내용이 없으면
      // auto 와 visible 의 레이아웃은 같다.
      for (let e = box.parentElement, i = 0; e && i < 10; e = e.parentElement, i++) {
        const cs = getComputedStyle(e);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible') e.style.overflow = 'visible';
      }
      box.style.outline = '6px solid #ea001e';
      box.style.outlineOffset = '6px';
      box.style.borderRadius = '8px';
      box.scrollIntoView({ block: 'center' });
      // 본문 칸의 가로 범위를 같이 돌려준다 — 왼쪽 목차를 빼고 찍기 위해서다(아래 clip).
      // 문단에서 위로 올라가며 "아직 화면 전체 폭이 되지 않은" 가장 넓은 조상을 고른다.
      // 그게 본문 칸이다. 화면 폭에 닿는 순간 그건 페이지 틀이라 멈춘다.
      let col = box;
      for (let el = box.parentElement, i = 0; el && i < 10; el = el.parentElement, i++) {
        const r = el.getBoundingClientRect();
        if (r.width > window.innerWidth * 0.9) break;
        if (r.width >= col.getBoundingClientRect().width) col = el;
      }
      const c = col.getBoundingClientRect();
      // 본문 칸의 위끝. 그 위는 검색 아이콘만 있는 빈 머리말 띠라 슬라이드에서 자리만
      // 차지한다 — 잘라낼 지점으로 쓴다. 본문이 화면 위로 넘어가 있으면 음수라 0이 된다.
      return { x: c.left, w: c.width, top: Math.max(0, c.top - 12) };
    }
    return null;
  }, needle);
  if (!found) {
    // 렌더 대기는 통과했으니 문구는 화면에 있다 — 잡을 요소를 못 고른 것이다(도구 문제).
    console.error(`문구는 본문에 있는데 표시할 요소를 못 골랐습니다: "${needle}"`);
    console.error('  → 원문이 바뀐 게 아닙니다. 더 짧은 문구로 다시 시도하세요.');
    process.exit(3);
  }
  await new Promise(r => setTimeout(r, 800));

  // 왼쪽 목차(TABLE OF CONTENTS · Filter by)는 증거가 아니라 길찾기 장치다. 뷰포트 폭의
  // 3분의 1을 먹으면서 본문을 좁은 칸으로 밀어, Slack 에서도 Instagram 에서도 읽는 걸
  // 방해하기만 한다 (2026-09-15 사용자 지적). **목적지별로 다른 그림을 만들지 않는다** —
  // 캡처 한 장에서 빼면 두 곳이 같은 증거를 본다.
  // DOM 에서 목차를 지워도 본문은 좁은 칸에 남고 왼쪽이 통째로 빈다(2026-09-15 실측).
  // 레이아웃과 싸우지 말고 본문 칸만 잘라 찍는다 — 결과가 세로로 길어져 Instagram 3:4
  // 슬라이드에도 더 잘 맞는다.
  const PAD_X = 24;
  const clip = {
    x: Math.max(0, Math.round(found.x - PAD_X)),
    y: Math.round(found.top),
    width: Math.min(VIEWPORT.width, Math.round(found.w + PAD_X * 2)),
    height: VIEWPORT.height - Math.round(found.top),
  };
  if (clip.x + clip.width > VIEWPORT.width) clip.width = VIEWPORT.width - clip.x;
  await page.screenshot({ path: out, clip });
  console.log(`${out} ← ${url}`);
} finally {
  await browser.close();
}
