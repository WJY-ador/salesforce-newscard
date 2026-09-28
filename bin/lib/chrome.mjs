/**
 * Chrome 헤드리스 공용 — 경로·dumpDom·상주 브라우저 풀을 한 곳에 둔다.
 *
 * 두 가지 진입점:
 *   dumpDom(url)                동기 · 매 호출 Chrome 을 새로 띄운다 (--dump-dom). 단발 조회용.
 *   openBrowser({concurrency})  비동기 · puppeteer-core 로 Chrome 한 개를 띄워 두고 페이지를 돌려 쓴다.
 *                               수집기(수십 URL)는 이걸 쓴다 — 콜드 스타트 제거 + 동시 N 페이지.
 *
 * 왜 상주 브라우저인가 (2026-09-09 리팩토링 · 사용자 승인): 수집기 7종이 URL 마다 Chrome 을 새로
 * 띄웠다 — 하루 40여 번 × 기동 2~3초 + virtual-time-budget 25초를 **직렬로** 기다렸다.
 * 상주 브라우저 + 동시 4 페이지로 sent-drift 5분 → 1분대, 전체 루틴 25분 → 8~10분이 목표다.
 *
 * killSignal: 'SIGKILL' 은 필수다 (2026-09-09 실측). execFileSync 의 기본 killSignal 은 SIGTERM 이고,
 * spawnSync 계열은 시그널을 보낸 뒤에도 자식이 실제로 죽을 때까지 기다린다 — Chrome 헤드리스가
 * SIGTERM 을 무시하는 상태에 빠지면 timeout: 120000 이 무효다. 실측: fetch-sent-drift 가 dump-dom
 * 한 건에서 83분 멈춰 그날 루틴이 통째로 막혔다 (content/issue-log.md
 * ISSUE-202609-EXECFILESYNC-SIGTERM-HANG). puppeteer 의 browser.close() 는 자체 타임아웃 뒤 SIGKILL 이라
 * 같은 함정이 없다.
 *
 * 주의 — Aura 의 #auraLoadingBox(<span>Loading</span>) 는 부트 뒤에도 DOM 에 남는다(실측 2026-09-09: 38초
 * 관찰 내내 존재). --dump-dom 결과에는 없던 줄이라 본문 해시가 갈리는데, 이건 기다려서 해결되는 것이
 * 아니므로 파서 쪽(fetch-sent-drift bodyLines)에서 홀로 선 "Loading" 줄을 뺀다.
 *
 * 렌더 완료 판정 (openBrowser): --dump-dom 은 virtual-time-budget 으로 타이머를 빨리 돌려 Aura SPA 가
 * 본문을 그린 뒤의 DOM 을 준다. puppeteer 에는 그 스위치가 없어 **본문 텍스트 길이가 안정될 때까지**
 * 폴링한다 (0.5초 간격, 3회 연속 동일 + 최소 5초, 최대 25초). help.salesforce.com 은 본문 끝 표식
 * ("Did this article solve" · "Knowledge Article Number") 이 보이면 즉시 끝낸다.
 *
 * 경로는 NEWSCARD_CHROME 환경변수로 덮을 수 있다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const CHROME = process.env.NEWSCARD_CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** 첫 사용 전에 부른다 — 없는 경로로 execFileSync 가 ENOENT 스택을 뿜는 것보다
 *  "무엇을 설치·설정하라"가 낫다. */
export function assertChrome() {
  if (!existsSync(CHROME)) {
    throw new Error(
      `Chrome 실행 파일이 없습니다: ${CHROME}\n` +
      'Google Chrome 을 설치하거나 NEWSCARD_CHROME 환경변수로 경로를 지정하세요.');
  }
}

/** 동기 단발 — JS 를 실행시킨 렌더 DOM 을 받는다. 수집 루프에서는 openBrowser 를 쓴다. */
export function dumpDom(url) {
  assertChrome();
  return execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=25000', '--dump-dom', url
  ], { maxBuffer: 96 * 1024 * 1024, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL' });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 동시 n 개로 items 를 fn 에 흘린다 — 결과 순서는 items 순서 그대로. */
export async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

// 끝 표식만 보면 안 된다 — 릴리스 노트 페이지는 피드백 위젯("Did this article solve")이 본문·브레드크럼
// ("You are here:")보다 먼저 그려진다 (실측 2026-09-09: 끝 표식에서 끊으니 4/4 본문 0줄). KB 는
// "Knowledge Article Number" 하나로 충분하고, 릴리스 노트는 시작·끝 표식이 둘 다 있어야 완료다.
const DONE_MARKERS = /Knowledge Article Number|(?=[\s\S]*You are here:)[\s\S]*Did this article solve/i;

/**
 * 상주 브라우저. 반환: { dumpDom(url) → Promise<string>, close() }.
 *   concurrency  동시에 여는 페이지 수 (기본 4)
 *   settleMs     텍스트 안정 판정 최대 대기 (기본 25000 — --virtual-time-budget 과 같은 값)
 *   pageTimeout  페이지 하나의 총 상한 (기본 90000) — 넘으면 그 URL 만 실패한다
 */
export async function openBrowser({ concurrency = 4, settleMs = 25000, pageTimeout = 90000 } = {}) {
  assertChrome();
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1400,1000']
  });
  let active = 0;
  const waiters = [];
  const acquire = () => new Promise(r => { if (active < concurrency) { active++; r(); } else waiters.push(r); });
  const release = () => { active--; const w = waiters.shift(); if (w) { active++; w(); } };

  async function fetchOnce(url) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1400, height: 1000 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // 텍스트 안정 대기
      const t0 = Date.now();
      let last = -1, same = 0;
      while (Date.now() - t0 < settleMs) {
        await sleep(500);
        const { len, done } = await page.evaluate(m => {
          const t = document.body?.innerText || '';
          return { len: t.length, done: new RegExp(m, 'i').test(t) };
        }, DONE_MARKERS.source).catch(() => ({ len: -1, done: false }));
        if (done && Date.now() - t0 >= 1500) break;
        same = len === last ? same + 1 : 0;
        last = len;
        // 최소 5초 — Aura 셸(약 1,000자)이 먼저 안정돼 보이고 본문은 5~6초에 온다 (실측 2026-09-09)
        // len > 2000 — Aura 셸만 그려진 상태(약 1,000자)에서 안정으로 오판하지 않는다 (실측: KB 2/7 본문 없음)
        if (same >= 3 && Date.now() - t0 >= 5000 && len > 2000) break;
      }
      return await page.content();
    } finally {
      await page.close().catch(() => {});
    }
  }

  return {
    async dumpDom(url) {
      await acquire();
      try {
        let timer;
        const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`page timeout ${pageTimeout}ms: ${url}`)), pageTimeout); });
        try { return await Promise.race([fetchOnce(url), guard]); }
        finally { clearTimeout(timer); }
      } finally { release(); }
    },
    async close() { await browser.close().catch(() => {}); }
  };
}
