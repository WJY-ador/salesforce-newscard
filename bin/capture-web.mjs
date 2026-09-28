#!/usr/bin/env node
/**
 * 공개 공식 페이지를 화면 증거로 캡처한다 (2026-09-18 신설).
 *
 *   node bin/capture-web.mjs --slug df26-day3-architect \
 *     --url https://architect.salesforce.com/docs/architect/well-architected/guide/change-log.html \
 *     --name well-architected-change-log [--selector main] [--full]
 *
 *   → content/web-evidence/<slug>/<name>.png
 *
 * 왜 필요한가: 사용자 지적 "텍스트로만 보니까 사용자는 어떤 화면인지를 모른다"(2026-09-18).
 * 일상 레인은 org Setup 화면을 증거로 붙이는데(카드 규율), 이벤트 레인은 org 에 대응물이
 * 없다는 이유로 그 단계를 통째로 건너뛰고 있었다. 그런데 **독자가 실제로 찾아갈 화면**은
 * 있다 — 공식 문서 페이지, 제품 블로그의 제품 화면, 릴리스 노트. 그건 org 가 아니라
 * 공개 웹이라 누구나 열 수 있고, 캡처해서 증거로 붙일 수 있다.
 *
 * org 캡처와 구분해서 content/web-evidence/ 에 둔다. org-evidence 는 접근 통제가 걸린
 * 화면이라 취급 규칙이 다르다(고객사 org·샌드박스 캡처 금지). 여기 들어오는 건 전부
 * 로그인 없이 열리는 공개 페이지여야 한다 — 로그인 뒤 화면을 이 폴더에 넣지 않는다.
 *
 * 저작권: 남의 페이지 스크린샷이다. 뉴스 카드에서 "이 발표가 어디에 적혀 있나"를 보이는
 * 지시적 사용 범위에서만 쓴다. 페이지를 통째로 복제하지 말고 해당 대목만 잘라 붙인다
 * (--selector 를 쓰는 이유). 캡처 대상 URL 은 카드 source.links 에 반드시 같이 적는다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { CHROME, assertChrome } from './lib/chrome.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.NEWSCARD_CONTENT_DIR ? resolve(process.env.NEWSCARD_CONTENT_DIR) : resolve(ROOT, 'content');
const OUT = process.env.NEWSCARD_OUT_DIR ? resolve(process.env.NEWSCARD_OUT_DIR) : resolve(ROOT, 'out');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const has = k => args.includes(k);

const SLUG = opt('--slug');
const URL_ = opt('--url');
const NAME = opt('--name');
const SELECTOR = opt('--selector');
const WIDTH = Number(opt('--width') || 1440);
const HEIGHT = Number(opt('--height') || 900);

if (!SLUG || !URL_ || !NAME) {
  console.error('사용법: node bin/capture-web.mjs --slug <카드슬러그> --url <https://…> --name <파일명> [--selector <CSS>] [--full]');
  process.exit(1);
}
if (!/^https:\/\//.test(URL_)) { console.error('✗ https URL 만 받습니다'); process.exit(1); }

const outDir = resolve(CONTENT, 'web-evidence', SLUG);
const outPath = resolve(outDir, `${NAME}.png`);
mkdirSync(outDir, { recursive: true });

assertChrome();
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  // 봇 차단(403)이 흔하다 — 실제 브라우저와 같은 UA 를 쓴다. 우회가 아니라, 우리가
  // 사람이 여는 것과 같은 페이지를 보려는 것이다. 그래도 막히면 캡처를 포기하고 보고한다.
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  const res = await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 60000 });
  const status = res ? res.status() : 0;
  if (status >= 400) {
    console.error(`✗ HTTP ${status} — 캡처하지 않습니다: ${URL_}`);
    process.exit(2);
  }
  // 쿠키 배너·채팅 위젯이 본문을 덮는다(실측: architect.salesforce.com 에서 배너가 상단
  // 1/6 을, Agentforce 위젯이 우측을 가렸다). 동의 버튼을 **누르지 않는다** — 우리가 사용자
  // 대신 쿠키에 동의할 이유가 없고, 캡처에는 화면에서 치우기만 하면 충분하다. 그래서
  // 클릭 대신 CSS 로 감춘다: 화면에 고정돼 떠 있는 요소(fixed·sticky)만 골라 숨긴다.
  // 본문 안에 든 것은 건드리지 않으므로 페이지 내용이 잘리지 않는다.
  await page.evaluate(() => {
    const hidden = [];
    // 채팅 위젯은 대개 iframe 이고, 그 iframe 의 부모가 fixed 가 아닐 수 있다(실측:
    // Agentforce 위젯이 이 필터를 그대로 통과했다). iframe 은 본문 콘텐츠인 경우가
    // 드물고 증거 캡처에 필요하지도 않으므로 화면에 뜬 것은 전부 숨긴다.
    for (const fr of document.querySelectorAll('iframe')) {
      const r = fr.getBoundingClientRect();
      if (r.width > 60 && r.height > 60) { fr.style.setProperty('display', 'none', 'important'); hidden.push('IFRAME'); }
    }
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 40) continue;          // 작은 배지·버튼은 둔다
      if (r.width * r.height < 20000) continue;
      el.style.setProperty('display', 'none', 'important');
      hidden.push(el.tagName);
    }
    return hidden.length;
  }).catch(() => 0);
  await new Promise(r => setTimeout(r, 1200));

  // ── 이벤트 레인 전용 두 모드 (2026-09-18) ──────────────────────────────
  // 릴리스 노트 레인은 capture-docpage.mjs 로 **문단**에 빨간 네모를 친다. 이벤트 레인은
  // 다른 프로세스다(사용자 지시) — 독자가 보고 싶은 건 문단이 아니라 **제품 화면**이고,
  // 그건 공식 글에 실린 스크린샷이나 데모 영상 프레임이다. 그래서 여기서는 네모를 치지
  // 않고 화면 자체를 원본 해상도로 잘라 낸다.
  const PICK_IMAGE = opt('--pick-image');       // N번째로 큰 <img> (1 = 가장 큼)
  const VIDEO_FRAME = opt('--video-frame');     // <video> 의 N초 프레임
  if (VIDEO_FRAME != null) {
    // 영상은 레이아웃이 0x0 이어도 디코딩은 된다 — 화면을 찍는 대신 canvas 에 그려 뽑는다.
    // 같은 출처(salesforce.com) 영상이라 canvas 가 오염되지 않는다.
    const dataUrl = await page.evaluate(async sec => {
      const v = document.querySelector('video');
      if (!v) return null;
      v.muted = true;
      v.preload = 'auto';
      if (v.readyState < 1) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
      await new Promise((r, j) => {
        v.addEventListener('seeked', r, { once: true });
        v.addEventListener('error', j, { once: true });
        v.currentTime = Math.min(Number(sec), Math.max(0, v.duration - 0.5));
      });
      if (v.readyState < 2) await new Promise(r => v.addEventListener('loadeddata', r, { once: true }));
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      return { url: c.toDataURL('image/png'), w: c.width, h: c.height, dur: v.duration, src: v.currentSrc || v.src };
    }, VIDEO_FRAME).catch(e => ({ err: String(e) }));
    if (!dataUrl || dataUrl.err || !dataUrl.url) { console.error(`✗ 영상 프레임을 못 뽑았습니다: ${dataUrl && dataUrl.err || 'video 없음'}`); process.exit(4); }
    writeFileSync(outPath, Buffer.from(dataUrl.url.split(',')[1], 'base64'));
    const title = await page.title();
    writeFileSync(resolve(outDir, `${NAME}.source.txt`),
      `${URL_}\n${title}\n영상 ${dataUrl.src}\n프레임 ${VIDEO_FRAME}s / ${Math.round(dataUrl.dur)}s\n캡처 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST\n`);
    console.log(`✓ 영상 프레임 ${VIDEO_FRAME}s (${dataUrl.w}x${dataUrl.h}) — content/web-evidence/${SLUG}/${NAME}.png`);
    console.log(`  출처 ${URL_} — 이 URL 을 카드 source.links 에도 넣으세요`);
    await browser.close();
    process.exit(0);
  }

  let clip = null;
  if (PICK_IMAGE != null) {
    // 페이지 끝까지 스크롤해 lazy 이미지를 다 올린 뒤, 테마 장식(/themes/)을 뺀 <img> 를
    // 렌더 면적순으로 세운다. 공식 글에서 제일 큰 이미지가 제품 스크린샷이다(실측: admin 글).
    const pick = await page.evaluate(async nth => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
      await new Promise(r => setTimeout(r, 800));
      const list = [...document.querySelectorAll('img')]
        .filter(i => !/\/themes\//.test(i.currentSrc || i.src || ''))
        .map(i => { const r = i.getBoundingClientRect(); return { i, r, area: r.width * r.height }; })
        .filter(o => o.r.width >= 300 && o.r.height >= 150)
        .sort((a, b) => b.area - a.area);
      const o = list[Math.max(0, Number(nth) - 1)];
      if (!o) return { count: list.length };
      o.i.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 600));
      const r = o.i.getBoundingClientRect();
      // 가까운 제목 — 어느 기능의 화면인지 source.txt 에 남긴다
      let h = o.i, head = '';
      for (let k = 0; k < 40 && h; k++) { h = h.previousElementSibling || h.parentElement; if (!h) break; if (h.matches && h.matches('h1,h2,h3,h4')) { head = h.textContent.trim().slice(0, 80); break; } }
      return { x: r.x, y: r.y, width: r.width, height: r.height, count: list.length, head, alt: o.i.alt || '', src: (o.i.currentSrc || o.i.src || '').split('?')[0] };
    }, PICK_IMAGE);
    if (!pick || !pick.width) { console.error(`✗ 제품 이미지를 못 찾았습니다 (후보 ${pick ? pick.count : 0}건)`); process.exit(3); }
    clip = { x: pick.x, y: pick.y, width: pick.width, height: pick.height };
    console.log(`  이미지 후보 ${pick.count}건 중 ${PICK_IMAGE}번째 — 제목 "${pick.head}" · alt "${pick.alt.slice(0, 60)}"`);
    writeFileSync(resolve(outDir, `${NAME}.source.txt`),
      `${URL_}\n${await page.title()}\n이미지 ${pick.src}\n절 제목 ${pick.head}\nalt ${pick.alt}\n캡처 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST\n`);
  } else if (SELECTOR) {
    // 첫 매치를 쓰면 안 된다 (2026-09-18 실측): admin.salesforce.com 에서 `article` 의 첫
    // 매치가 사이드의 관련글 티저였고, **2025년 글**이 2026년 카드의 증거로 잡혔다.
    // 잘못된 연도 화면이 증거로 붙는 건 증거가 없는 것보다 나쁘다. 그래서 매치 중
    // **가장 넓은 것**을 고른다 — 본문이 티저보다 작은 경우는 없다.
    const pick = await page.evaluate(sel => {
      const els = [...document.querySelectorAll(sel)];
      if (!els.length) return null;
      let best = null, bestArea = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = r; }
      }
      return best ? { x: best.x + scrollX, y: best.y + scrollY, width: best.width, height: best.height, count: els.length } : null;
    }, SELECTOR);
    if (!pick) { console.error(`✗ selector 를 못 찾았습니다: ${SELECTOR}`); process.exit(3); }
    if (pick.count > 1) console.log(`  selector "${SELECTOR}" 매치 ${pick.count}건 — 가장 넓은 것을 씁니다`);
    clip = { x: pick.x, y: pick.y, width: pick.width, height: Math.min(pick.height, 2400) };
  }
  // clip 은 문서 좌표다. --pick-image 는 scrollIntoView 뒤 뷰포트 좌표를 돌려주므로 스크롤을 더한다.
  if (clip && PICK_IMAGE != null) {
    const s = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    clip = { ...clip, x: clip.x + s.x, y: clip.y + s.y };
  }
  await page.screenshot({ path: outPath, fullPage: has('--full') && !clip, ...(clip ? { clip } : {}) });
  const title = await page.title();
  // --pick-image 는 위에서 더 자세한 source.txt 를 이미 썼다 — 덮지 않는다.
  if (PICK_IMAGE == null) {
    writeFileSync(resolve(outDir, `${NAME}.source.txt`),
      `${URL_}\n${title}\n캡처 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST\n`);
  }
  console.log(`✓ 캡처 — content/web-evidence/${SLUG}/${NAME}.png`);
  console.log(`  ${title}`);
  console.log(`  출처 ${URL_} (HTTP ${status}) — 이 URL 을 카드 source.links 에도 넣으세요`);
} finally {
  await browser.close();
}
