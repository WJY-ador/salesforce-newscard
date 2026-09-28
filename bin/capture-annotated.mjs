/**
 * Org 화면 캡처 + 빨간 네모 주석 — 카드 스레드에 첨부하는 실측 증거 (2026-08-04 확정 양식)
 *
 *   node bin/capture-annotated.mjs <org> "<찾을 문구>" <out.png> [setup-path]
 *
 *   기본 경로는 /lightning/setup/ReleaseUpdates/home. 예:
 *     node bin/capture-annotated.mjs my-org "Enable Profile Filtering" out/ru.png
 *     node bin/capture-annotated.mjs my-org "of 38" out/profiles.png /lightning/setup/EnhancedProfiles/home
 *   <org> 는 sf CLI 로 로그인한 org 의 별칭이다. 인증은 sf CLI 세션만 쓰고 이 스크립트는 자격 증명을 저장하지 않는다.
 *
 * 동작 원리 (전부 실측으로 굳힌 규칙):
 *   - frontdoor sid 는 발급 즉시 사용한다 — 몇 분만 지나도 로그인 화면이 뜬다
 *   - Lightning 목록은 lazy render — 스크롤 컨테이너를 끝까지 훑어 DOM 을 다 올린다
 *   - 빨간 네모는 이미지 후처리가 아니라 DOM outline 주입 — 의존성이 없다
 *   - 매칭은 텍스트 노드(리프)에서 시작해 카드 크기(120–800 x 400–1100px) 조상으로
 *     승격한다 — div 래퍼를 잡으면 body 급으로 새는 사고가 실측으로 있었다
 *   - 클래식 Setup 페이지(Profiles 목록 등)는 iframe 임베드 — 프레임을 순회한다
 *   - 조회 전용이다. org 에 어떤 쓰기도 하지 않는다
 */
import { execFileSync } from 'node:child_process';
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

const [org, needle, out, path = '/lightning/setup/ReleaseUpdates/home'] = process.argv.slice(2);
if (!org || !needle || !out) {
  console.error('사용법: node bin/capture-annotated.mjs <org> "<찾을 문구>" <out.png> [setup-path]');
  process.exit(1);
}

// 발급 즉시 사용 — 이 사이에 다른 작업을 끼우지 않는다
const j = JSON.parse(execFileSync('sf', ['org', 'open', '-p', path, '--url-only', '-o', org, '--json'], { encoding: 'utf8', timeout: 60000 }));
if (!j.result?.url) {
  console.error('sf org open 이 URL 을 주지 않았습니다 — org 인증을 확인하세요.');
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
  await page.goto(j.result.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => /Setup|Release Updates|설정|릴리스 업데이트/i.test(document.body?.innerText || ''), { timeout: 120000 });
  await new Promise(r => setTimeout(r, 8000)); // Lightning 부트스트랩 + iframe 로드

  // 메인 프레임이면 목록 끝까지 스크롤해 lazy 카드를 DOM 에 올린다
  await page.evaluate(async () => {
    const sc = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 200)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || document.scrollingElement;
    for (let y = 0; y <= sc.scrollHeight; y += 700) { sc.scrollTop = y; await new Promise(r => setTimeout(r, 300)); }
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  const annotate = text => {
    // 비교는 **공백을 접어서** 한다 — textContent 는 공백을 안 접어 Lightning 이 라벨을
    // 줄바꿈·들여쓰기와 함께 렌더하면 멀쩡한 문구도 안 잡힌다 (2026-09-22 capture-docpage
    // 에서 같은 원인으로 두 번 연속 "문구 못 찾음" 이 났다).
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const textN = norm(text);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!norm(n.textContent).includes(textN)) continue;
      let el = n.parentElement, box = null;
      for (let i = 0; i < 10 && el; i++) {
        const r = el.getBoundingClientRect();
        if (r.height >= 120 && r.height <= 800 && r.width >= 400 && r.width <= 1100) box = el;
        if (r.width > 1100) break;
        el = el.parentElement;
      }
      if (!box) box = n.parentElement; // 작은 대상(카운터 등)은 리프 부모 그대로

      // 네모가 조상의 overflow 에 잘리는 것을 막는다.
      //
      // **근거 (2026-09-22 capture-docpage 실측)**: outline 은 요소 **바깥**에 그려져서,
      // 폭이 같은 조상이 overflow 를 자르면 좌우 변이 통째로 사라지고 위아래 선 두 개만
      // 남는다 — 증거 사진이 네모로 안 보인다. 거기선 조상의 overflow 를 visible 로
      // 되돌려 해결했다.
      //
      // **여기서는 그걸 그대로 못 쓴다**: Lightning Setup 은 진짜 스크롤 컨테이너를 쓴다.
      // 스크롤 중인 컨테이너의 overflow 를 풀면 scrollTop 이 0 으로 돌아가고 패널이
      // 펼쳐져 화면이 망가진다. 그래서 두 단계로 나눈다.
      //   ① 안 스크롤되는(내용이 넘치지 않는) 클리퍼만 visible 로 되돌린다 — 안전하다.
      //   ② 그래도 남은 클리퍼가 네모를 자를 자리면 outline 을 요소 **안쪽**에 그린다.
      //      글자를 조금 먹지만 네모 모양은 지킨다.
      const OUT = 6, OFF = 4;            // 선 두께 · 바깥 여백 → 바깥으로 10px 필요
      let clipped = false;
      for (let e = box.parentElement, i = 0; e && e !== document.body && i < 12; e = e.parentElement, i++) {
        const cs = getComputedStyle(e);
        if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const scrolls = e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2;
        if (!scrolls) { e.style.overflow = 'visible'; continue; }   // ① 안전한 클리퍼
        const br = box.getBoundingClientRect(), er = e.getBoundingClientRect();
        if (br.left - er.left < OUT + OFF || er.right - br.right < OUT + OFF) clipped = true;  // ②
      }
      box.style.outline = `${OUT}px solid #ea001e`;
      box.style.outlineOffset = clipped ? `-${OUT}px` : `${OFF}px`;
      box.style.borderRadius = '8px';
      box.scrollIntoView({ block: 'center' });
      return true;
    }
    return false;
  };

  // 메인 프레임 → 실패하면 iframe 순회 (클래식 Setup)
  let found = await page.evaluate(annotate, needle).catch(() => false);
  if (!found) {
    for (const f of page.frames()) {
      try { if (await f.evaluate(annotate, needle)) { found = true; break; } } catch {}
    }
  }

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: out });
  console.log((found ? '빨간 네모 캡처 완료' : '문구 못 찾음 — 현재 화면만 캡처 (그 사실도 증거다)') + ': ' + out);

  // 못 찾았을 때 가장 흔한 원인은 **언어**다 (2026-09-16 실측). 릴리스 노트는 language=en_US 로
  // 고정해 받는데 한국어 org 는 Organization.LanguageLocaleKey = ko 다. 문서 문구를
  // 그대로 needle 로 쓰면 영영 안 걸린다 — 그날 "Allow OAuth User-Agent Flows" 가 0건이었고
  // 화면 라벨 "OAuth 사용자-에이전트 플로 허용" 으로 던지니 한 번에 잡혔다.
  // exit 3 만으로는 조용하다(로그 한 줄이라 지나친다). org 언어를 같이 찍어 원인을 먼저 보여준다.
  if (!found) {
    try {
      const o = JSON.parse(execFileSync('sf', ['data', 'query', '-q',
        'SELECT LanguageLocaleKey FROM Organization', '-o', org, '--json'], { encoding: 'utf8', timeout: 60000 }));
      const lang = o.result?.records?.[0]?.LanguageLocaleKey;
      if (lang) {
        console.error(`  ⚠ 이 org 의 화면 언어는 ${lang} 입니다.`);
        if (lang !== 'en_US') console.error('    릴리스 노트(en_US) 문구를 그대로 쓰지 말고 **화면에 보이는 라벨**로 다시 던지세요.');
      }
    } catch {}
  }
  process.exit(found ? 0 : 3);
} finally {
  await browser.close();
}
