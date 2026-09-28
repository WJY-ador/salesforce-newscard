/**
 * UI 표면 감시 — 릴리스 노트에 안 실리는 화면 변화를 org 에서 직접 관측한다 (2026-08-04)
 *
 *   node bin/fetch-ui-surfaces.mjs [--keep] [--devhub <alias>] [--license-org <alias>] [--customer-org <alias>]
 *     기본값: SF_DEVHUB(없으면 sf 기본 Dev Hub) · SF_TARGET_ORG · SF_CUSTOMER_ORG. org 가 비면 그 트랙을 건너뛴다.
 *     → content/ui-surfaces.json          표면별 시그니처 스냅샷 (커밋)
 *     → out/pending-changes.json          변화가 있으면 카드 후보로 누적
 *     → content/org-evidence/ui-<표면>/   변화 시 빨간 네모 캡처
 *
 * 왜 필요한가 (실측 2026-08-04). 즐겨찾기 드롭다운에 "즐겨찾기 찾기" 검색창이
 * 생겼는데 어디에도 안 잡혔다 — behavior-changes 필터는 신기능 동사(Find…)로
 * 시작하는 제목을 의도적으로 버리고, 이번 릴리스 노트 인덱스 1,900여 링크에는
 * favorites 항목 자체가 0건이었다. 마이너 UI 개선은 문서에 항목 없이 조용히
 * 풀린다. 그래서 문서가 아니라 화면을 diff 한다 — retirements 가 KB 문서를
 * diff 하는 것과 같은 철학이다.
 *
 * 왜 scratch 인가 (사용자 지적 2026-08-04). 실사용 org 는 ① 즐겨찾기에
 * 고객명이 찍혀 캡처가 민감정보 유출이 되고 ② 사용자 행동이 diff 노이즈가 되고
 * ③ 릴리스 적용이 늦을 수 있다. 매일 새 scratch 는 사용자 상태가 항상 0이라
 * diff 가 순수 플랫폼 변화만 잡는다. 시드 데이터는 이름을 고정해 노이즈를 없앤다.
 *
 * 시그니처는 픽셀이 아니라 텍스트다 — 컨트롤 라벨·placeholder·버튼 텍스트.
 * "즐겨찾기 찾기" 입력창의 등장은 added 한 줄로 뜬다. 숫자는 마스킹(#)한다.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { normalizeSignature, normalizeStructural, diffSurfaces, migrateSnapshot, splitLicenseGated, stripGlobalChrome, gateCandidates } from './lib/ui-surface.mjs';
import { mergePending } from './lib/pending.mjs';
import { CHROME, assertChrome } from './lib/chrome.mjs';
import { readJson, writeJson } from './lib/io.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.NEWSCARD_CONTENT_DIR ? resolve(process.env.NEWSCARD_CONTENT_DIR) : resolve(ROOT, 'content');
const OUT = process.env.NEWSCARD_OUT_DIR ? resolve(process.env.NEWSCARD_OUT_DIR) : resolve(ROOT, 'out');
const SNAP = resolve(CONTENT, 'ui-surfaces.json');
const PENDING = resolve(OUT, 'pending-changes.json');

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const DEVHUB = args.includes('--devhub') ? args[args.indexOf('--devhub') + 1] : (process.env.SF_DEVHUB || null);
const ALIAS = 'ui-surfaces';
// 라이선스 트랙 (2026-08-11 확정) — 소 scratch 에는 안 보이는 라이선스 게이트
// 기능을 잡는 두 번째 트랙. 조회 전용이라 시드·즐겨찾기 쓰기를 하지 않는다.
const LICENSE_ORG = args.includes('--license-org') ? args[args.indexOf('--license-org') + 1] : (process.env.SF_TARGET_ORG || null);
const SKIP_LICENSE = args.includes('--skip-license') || !LICENSE_ORG;
const ONLY_LICENSE = args.includes('--only-license');
/**
 * 3번째 트랙 — **고객 org 급** (2026-08-11 확정). `--customer-org` 또는 `SF_CUSTOMER_ORG`.
 * 왜 필요한가: 두 트랙(소 scratch vs 데모 org) 차집합은 "데모 org 에 깔린 산업 패키지
 * 목록"에 가까워 판별력이 약했다 (실측 예상 76개가 전부 데모 앱).
 * 실무 질문은 "고객 org 급에는 왔나"다. 라이선스 org 에는 있는데 고객 org 급에는
 * 없는 것 = **아직 도착 안 한 기능** 목록이고, 그게 도착하는 날이 곧 뉴스다.
 * 실측 근거: Agentforce Grid 는 Dev·신규 org 에 이미 있고 고객 org 급 테스트 org 에는 없었다.
 */
const CUSTOMER_ORG = args.includes('--customer-org') ? args[args.indexOf('--customer-org') + 1] : (process.env.SF_CUSTOMER_ORG || null);
const SKIP_CUSTOMER = args.includes('--skip-customer') || !CUSTOMER_ORG;
const ONLY_CUSTOMER = args.includes('--only-customer');
/**
 * 두 트랙 차집합으로 "라이선스로 열린 컨트롤"을 표시한다 — **구조 시그니처로만** 한다.
 * 2026-08-11 실측 경과: 라벨(텍스트)로 비교하니 전 표면 100%가 gated 로 나왔고 원인은
 * ① scratch 영어 UI vs 라이선스 org 한국어 UI ② 선택자 모드 차이 ③ 데모 org 유틸리티 바였다.
 * 셋 다 언어·앱 구성 문제라 라벨 비교로는 못 고친다. 그래서 언어를 안 타는 식별자
 * (링크 경로·버튼 name·`sfdc:StandardButton…`)로 비교하고, 전역 크롬을 뺀 뒤
 * 화이트리스트(`gateCandidates`)로 좁힌다 — 103개 → 6개, 남은 6개는 전부 진짜였다
 * (라이선스 org Setup 홈에만 있는 기능 게이트 노드).
 * `--no-gate-check` 로 끌 수 있다.
 */
const GATE_CHECK = !args.includes('--no-gate-check');

/**
 * 표면별 후보 생성 담당 트랙 (2026-08-31 확정).
 *
 * 레코드 페이지는 **고객 트랙만** 카드 후보를 만든다. license 트랙
 * org 는 실사용 데모 org 라 같은 표면에 노이즈원이 둘이나 있다:
 *   ① 콘솔 앱이라 `<레코드명> | 계정 닫기` 로 레코드명이 시그니처에 섞인다
 *   ② Open CTI 소프트폰 유틸리티 패널이 실행마다 펼침/접힘이 갈린다
 *      (실측 2026-08-31: 같은 recordId 로 10분 간격 재실행에 Available · Dial Pad ·
 *       Enter a name... · Help · Settings · Simulate an incoming call 7개가 +7 로 재등장)
 * 고객 트랙 org 는 같은 표면에서 소프트폰 패널이 없고 레코드명도 안 섞인다 (실측: 45줄 중
 * 소프트폰 컨트롤 0개, 레코드명 라벨 0개) — 그래서 이 표면의 판정은 고객 트랙이 맡는다.
 *
 * **수집은 전 트랙 그대로 한다.** 구조 시그니처가 게이트 판별(scratch 대비)과
 * 미도착 판별(customer 대비)에 쓰이기 때문이다 — 실측 2026-08-31 미도착 목록에
 * `record-page-account :: sfdc:StandardButton.Account.Edit` 가 올라와 있다.
 * 막는 것은 라벨 diff 의 **큐 적재**뿐이다.
 */
const CANDIDATE_OWNER = {
  'record-page-account': 'customer'
};

function sf(cmdArgs, opts = {}) {
  const out = execFileSync('sf', [...cmdArgs, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout || 300000, stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(out);
  if (j.status !== 0 && !opts.lenient) throw new Error(`sf ${cmdArgs.slice(0, 2).join(' ')} 실패: ${(j.message || '').slice(0, 160)}`);
  return j.result;
}

/**
 * 페이지 안에서 컨트롤 시그니처를 뽑는다 — 모든 프레임 공통.
 *
 * 선택자가 트랙마다 다르다. scratch 는 시드 이름이 고정이라 데이터까지 봐도 노이즈가
 * 없지만, 라이선스 트랙(실사용 테스트 org)은 레코드명·콘솔 탭·리스트 컬럼이 매일
 * 달라진다 — 그래서 `controls` 모드는 **컨트롤만** 본다 (레코드 링크 a[title],
 * 콘솔 탭 [role=tab], 리스트 헤더 th, 필드값 lightning-formatted-text 제외).
 */
/**
 * Shadow DOM 관통 수집기 (2026-08-11 실측으로 추가).
 * Lightning 은 LWC 컴포넌트를 shadow root 안에 그린다 — `document.querySelectorAll` 은
 * 그 안을 못 본다. 실측: App Launcher 를 열어도 라벨이 `Close` 한 줄만 잡혔다
 * (모달 내용 전체가 `one-app-launcher-*` shadow tree 안에 있었다).
 * 그래서 shadowRoot 를 재귀로 내려가며 모은다. 순환 방지로 방문 집합을 쓴다.
 */
const DEEP_WALK = `
  const deepAll = (sel) => {
    const out = [], seen = new Set();
    const visit = root => {
      if (!root || seen.has(root)) return;
      seen.add(root);
      try { for (const el of root.querySelectorAll(sel)) out.push(el); } catch {}
      let all = [];
      try { all = root.querySelectorAll('*'); } catch {}
      for (const el of all) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    return out;
  };
`;

const SELECTORS = {
  full: 'button, a[role], a[title], input, [role="tab"], [role="menuitem"], [role="option"], th, lightning-formatted-text',
  controls: 'button, input, [role="menuitem"], [role="option"]'
};

const extractScript = mode => `(() => {
  ${DEEP_WALK}
  const lines = [];
  const push = v => { if (v) lines.push(String(v)); };
  for (const el of deepAll(${JSON.stringify(SELECTORS[mode] || SELECTORS.full)})) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    push(el.getAttribute('aria-label'));
    push(el.getAttribute('placeholder'));
    push(el.getAttribute('title'));
    if (el.tagName !== 'INPUT' && el.innerText && el.innerText.length < 60) push(el.innerText);
  }
  return lines;
})()`;

async function collectFromAllFrames(page, mode = 'full') {
  const script = extractScript(mode);
  let lines = [];
  for (const f of page.frames()) {
    try { lines = lines.concat(await f.evaluate(script)); } catch {}
  }
  return lines;
}

/**
 * 구조 시그니처 — **언어를 타지 않는 식별자만** 뽑는다 (2026-08-11).
 * 라벨 비교는 org 언어가 다르면(scratch 영어 vs 라이선스 org 한국어) 성립하지 않아서,
 * 트랙 간 게이트 판별은 이쪽으로 한다. 뽑는 것: 링크 경로 · 버튼/액션 name ·
 * 리스트뷰 표준 버튼 식별자(`sfdc:StandardButton.…`) · 커스텀 엘리먼트 태그.
 */
const STRUCTURAL = `(() => {
  ${DEEP_WALK}
  const out = [];
  const push = v => { if (v) out.push(String(v)); };
  for (const a of deepAll('a[href]')) {
    const r = a.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    push(a.getAttribute('href'));
  }
  for (const el of deepAll('[name], [data-target-selection-name], [data-component-id]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    push(el.getAttribute('data-target-selection-name'));
    const n = el.getAttribute('name');
    if (n && n.length < 80) push(n);
  }
  for (const el of deepAll('*')) {
    const t = el.tagName;
    if (t.includes('-') && t.length < 40) push('tag:' + t.toLowerCase());
  }
  return out;
})()`;

async function collectStructural(page) {
  let items = [];
  for (const f of page.frames()) {
    try { items = items.concat(await f.evaluate(STRUCTURAL)); } catch {}
  }
  return items;
}

const settle = ms => new Promise(r => setTimeout(r, ms));

/**
 * 앱 메뉴 표면 — **UI 스크래핑이 아니라 API 로 본다** (2026-08-11 실측 후 교체).
 * 라이선스로 열리는 기능은 대개 "앱이 하나 생기는" 형태로 온다 (Agentforce Grid =
 * TabSet `AIWorkbench`). 그런데 App Launcher 모달은 ① 콘솔 앱에서 클릭이 안 먹고
 * ② 내용이 shadow tree 안이며 ③ 라벨이 org 언어를 탄다 — 세 번 다 실측으로 깨졌다.
 * `AppMenuItem` 은 사용자에게 보이는 앱·탭 목록을 그대로 주고, `Name` 은 API 명이라
 * 언어를 타지 않는다. 조회 전용 SOQL 한 방이면 끝난다.
 */
function collectAppMenu(org) {
  try {
    // TabSet(=앱)만 본다. 실측 2026-08-11 라이선스 org: 160건 중 TabSet 105 ·
    // ConnectedApplication 41 · Network 14. 뒤 둘은 설치·사이트 사정으로 흔들리고
    // "라이선스로 열린 기능"과 무관해서 감시 대상이 아니다.
    const r = sf(['data', 'query', '-q', "SELECT Type, Name FROM AppMenuItem WHERE Type = 'TabSet' ORDER BY Name", '-o', org], { lenient: true });
    const rows = (r && r.records) || [];
    return rows.filter(x => x && x.Name).map(x => `app:${x.Type}:${x.Name}`);
  } catch (e) {
    console.error(`  app-menu-api: 조회 실패 — ${String(e.message).slice(0, 80)}`);
    return [];
  }
}

/**
 * 표면 정의 — 이름·경로·(선택) 열기 상호작용.
 * 시작 6면 (2026-08-04 사용자 확정): 즐겨찾기·글로벌 검색·Setup 홈 +
 * 페이지 레이아웃(레코드 페이지)·리스트뷰·Lightning 앱.
 */
const SURFACES = [
  {
    name: 'favorites-dropdown',
    path: '/lightning/page/home',
    open: async page => {
      // 즐겨찾기 목록 드롭다운 버튼 (별 옆 화살표)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b =>
          /favorites list|즐겨찾기 목록/i.test(b.getAttribute('aria-label') || ''));
        if (btn) btn.click();
      });
      await settle(3000);
    }
  },
  {
    name: 'global-search',
    path: '/lightning/page/home',
    open: async page => {
      // 검색 버튼 클릭 → 확장 입력에 시드 이름 타이핑 → 인스턴트 결과 패널까지 연다.
      // 홈 화면과 동일 시그니처가 나오면 검색 UI 변화를 못 잡는다 (실측 1회차 사고).
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button, input')].find(x =>
          /search/i.test(x.getAttribute('aria-label') || x.getAttribute('placeholder') || ''));
        if (b) b.click();
      });
      await settle(2500);
      try { await page.keyboard.type('UI Probe', { delay: 60 }); } catch {}
      await settle(3500);
    }
  },
  { name: 'setup-home', path: '/lightning/setup/SetupOneHome/home' },
  { name: 'record-page-account', path: null /* 시드 후 결정 */ },
  { name: 'listview-account', path: '/lightning/o/Account/list?filterName=__Recent' },
  { name: 'app-sales-home', path: '/lightning/app/standard__LightningSales' }
];

/**
 * 한 org 의 표면을 순회해 시그니처·캡처를 모은다. 트랙 공용.
 * `surfaces` 는 이 트랙용으로 경로가 채워진 배열, `mode` 는 선택자 모드,
 * `tag` 는 캡처 파일명 접두어(트랙별로 덮어쓰기를 막는다).
 */
async function collectTrack({ org, surfaces, mode, tag }) {
  const signatures = {};
  const structurals = {};
  const screenshots = {};
  const j = sf(['org', 'open', '-p', '/lightning/page/home', '--url-only', '-o', org]);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1100']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 2 });
    await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => /Home|홈|Setup/i.test(document.body?.innerText || ''), { timeout: 120000 });
    await settle(6000);
    const origin = new URL(page.url()).origin;

    for (const s of surfaces) {
      const t0 = Date.now();
      try {
        await page.goto(origin + s.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await settle(9000); // Lightning 부트스트랩 + lazy render
        // 로딩 스피너가 보이는 동안은 시그니처를 뜨지 않는다 — 화면이 덜 그려진 것 ≠ 컨트롤이 사라진 것.
        // 실측 2026-09-23: scratch setup-home 이 스피너 상태로 찍혀 Recent Items 표 머리글
        // (NAME·OBJECT·TYPE)과 setup-agentic-* 태그가 통째로 빠진 -6 diff 가 큐에 올라왔다.
        // 같은 flake 가 2026-09-04 · 09-16 에도 되돌림으로 처리됐다. 태그 존재가 아니라
        // 가시성으로 판정한다 — lightning-spinner 태그는 정상 렌더 화면에도 숨은 채로 있다.
        await page.waitForFunction(
          () => [...document.querySelectorAll('.slds-spinner, lightning-spinner')]
            .every(el => !el.getClientRects().length),
          { timeout: 20000 }
        ).then(() => settle(1500))
          // 초과해도 던지지 않는다 — 던지면 수집 실패 경로로 빠져 진짜 변화까지 가려진다.
          .catch(() => console.log(`  ${tag}${s.name}: 스피너 20초 초과 — 그대로 수집`));
        if (s.open) await s.open(page);
        const lines = normalizeSignature(await collectFromAllFrames(page, mode));
        signatures[s.name] = lines;
        // 구조 시그니처는 같은 페이지에서 추출만 한 번 더 한다 — 페이지 재방문 없음
        structurals[s.name] = normalizeStructural(await collectStructural(page));
        const shot = `${OUT}/ui-${tag}${s.name}.png`;
        await page.screenshot({ path: shot });
        screenshots[s.name] = shot;
        console.log(`  ${tag}${s.name}: 시그니처 ${lines.length}줄 · 구조 ${structurals[s.name].length}줄 (${Math.round((Date.now() - t0) / 1000)}초)`);
      } catch (e) {
        signatures[s.name] = [];
        structurals[s.name] = [];
        console.error(`  ${tag}${s.name}: 수집 실패 — ${String(e.message).slice(0, 80)}`);
      }
    }
  } finally {
    await browser.close();
  }
  // 앱 메뉴는 브라우저를 닫은 뒤 API 로 붙인다 — 화면 표면과 같은 자리에 저장해
  // diff·게이트 판별이 동일하게 굴러간다 (캡처는 없다).
  const appMenu = collectAppMenu(org);
  signatures['app-menu-api'] = [...appMenu].sort();
  structurals['app-menu-api'] = [...appMenu].sort();
  console.log(`  ${tag}app-menu-api: 앱·탭 ${appMenu.length}건 (SOQL)`);

  return { signatures, structurals, screenshots };
}

/**
 * 트랙 하나의 diff → 스냅샷 보존분·큐 적재. 실패 표면은 이전 시그니처를 유지한다
 * (화면이 안 뜬 것 ≠ 컨트롤이 사라진 것).
 * `gateCheck` 가 있으면 added 줄을 라이선스 게이트/공통으로 갈라 큐에 표시한다.
 */
function diffTrack({ track, org, license, prevSurfaces, signatures, screenshots, evidencePrefix, gateCheck }) {
  // 표면 정의가 바뀌면(교체·삭제) 스냅샷에 유령 표면이 남아 매일 "수집 실패"로 뜬다.
  // 실측: app-launcher UI 표면을 app-menu-api 로 교체한 뒤 그 이름이 계속 살아 있었다.
  const known = new Set(Object.keys(signatures));
  const pruned = {};
  for (const [k, v] of Object.entries(prevSurfaces || {})) {
    if (known.has(k)) pruned[k] = v;
    else console.log(`  - ${k}: 표면 정의에서 사라짐 — 스냅샷에서 제거`);
  }
  const d = diffSurfaces(pruned, signatures);
  const kept = {};
  let changes = 0, failed = false;
  for (const [name, r] of Object.entries(d)) {
    if (r.failed) {
      kept[name] = pruned[name] || [];
      console.log(`  ~ ${name}: 수집 실패 — 이전 시그니처 유지`);
      failed = true;
      continue;
    }
    kept[name] = signatures[name];
    if (r.baseline) { console.log(`  = ${name}: 첫 스냅샷 (${signatures[name].length}줄)`); continue; }
    if (!r.added.length && !r.removed.length) continue;
    changes += 1;
    console.log(`  ! ${name}: +${r.added.length} / -${r.removed.length}`);
    r.added.slice(0, 6).forEach(l => console.log(`      + ${l}`));
    r.removed.slice(0, 6).forEach(l => console.log(`      - ${l}`));
    const gate = gateCheck ? gateCheck(name) : null;
    if (gate && gate.length) {
      console.log(`      ⚑ 라이선스 전용 식별자 ${gate.length}개 (언어 무관 구조 비교)`);
      gate.slice(0, 5).forEach(l => console.log(`         ⚑ ${l}`));
    }
    const owner = CANDIDATE_OWNER[name];
    if (owner && owner !== track) {
      console.log(`      · 후보 생성은 ${owner} 트랙 담당 — 큐 적재 건너뜀 (${track} 은 수집·구조 비교만)`);
      continue;
    }
    const q = mergePending(PENDING, [{
      key: `${track === 'scratch' ? '' : track + '-'}${name}-${(r.added[0] || r.removed[0] || 'change').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
      source: 'ui-surfaces', type: 'added',
      data: {
        surface: name, track, org, license,
        added: r.added, removed: r.removed,
        licenseGated: gate || null,
        screenshot: screenshots[name] || null
      }
    }]);
    if (q.added) console.log(`      대기 큐 +${q.added} (총 ${q.total})`);
    const evid = resolve(CONTENT, 'org-evidence', `ui-${evidencePrefix}${name}`);
    mkdirSync(evid, { recursive: true });
    if (screenshots[name]) execFileSync('cp', [screenshots[name], resolve(evid, 'changed.png')]);
    writeFileSync(resolve(evid, 'diff.json'), JSON.stringify({ surface: name, track, org, ...r, licenseGated: gate || null }, null, 2) + '\n');
  }
  return { kept, changes, failed };
}

/**
 * 조회 전용 트랙 실행 — 라이선스 트랙·고객 트랙이 같은 절차를 쓴다.
 * 어떤 쓰기도 하지 않는다 (시드·즐겨찾기 POST 없음). 레코드 페이지는 SOQL 로 고른다.
 */
// ── 실행 ───────────────────────────────────────────────
console.log(`■ UI 표면 감시 — 3트랙 병렬 (scratch${SKIP_LICENSE ? '' : ` + ${LICENSE_ORG}`}${SKIP_CUSTOMER ? '' : ` + ${CUSTOMER_ORG}`})`);
assertChrome();   // scratch 생성(수 분) 뒤에 Chrome 부재로 죽는 것보다 먼저 확인

const prev = migrateSnapshot(readJson(SNAP, null));
const prevTracks = prev.tracks || {};
const tracks = {};
let exitCode = 0;
let scratchSignatures = null;   // 트랙 내 라벨 diff 용
let scratchStructural = null;   // 라이선스 게이트 판별의 기준선 (언어 무관)
let totalChanges = 0;

// ── 3트랙 병렬 수집 → 순차 diff (2026-09-09 리팩토링 · 사용자 승인) ──────────
// 수집(브라우저·sf CLI)은 트랙끼리 독립이라 동시에 돌리고, diff·게이트·미도착 판별은 세 수집이
// 끝난 뒤 순서대로 한다 — 게이트는 scratch 구조, 미도착은 license 구조가 기준선이기 때문이다.
// 종전에는 A→B→C 직렬 ~6분이었고, 게이트 판별이 diffTrack **뒤에** 계산돼 큐 항목에 ⚑ 가
// 실리지 않는 순서 버그도 있었다(gateCheck 클로저가 빈 객체를 읽음). 이제 diff 전에 계산한다.
const RUN_SCRATCH = !ONLY_LICENSE && !ONLY_CUSTOMER;
const RUN_LICENSE = !SKIP_LICENSE && !ONLY_CUSTOMER;
const RUN_CUSTOMER = !SKIP_CUSTOMER && !ONLY_LICENSE;
const LICENSE_LABEL = '라이선스 게이트 기능이 보이는 org';
const CUSTOMER_LABEL = '고객 org 급 기준선 (도착 여부 판정용)';

async function collectScratch() {
  const t = Date.now();
  try {
    sf(['org', 'create', 'scratch', '--edition', 'developer', '--alias', ALIAS, '--duration-days', '1', '--wait', '15', ...(DEVHUB ? ['-v', DEVHUB] : [])], { timeout: 900000 });
    console.log(`  scratch 생성 (${Math.round((Date.now() - t) / 1000)}초)`);
  } catch (e) {
    // scratch 실패로 **라이선스 트랙까지 같이 죽는 것**을 막는다 (2026-08-11 실측:
    // 일일 한도 소진이 raw 스택으로 터져 프로세스가 끝났다). 한도 소진은 당일 재시도하지
    // 않는다 (2026-08-05 사용자 확정) — 스냅샷 비교라 다음 날 이어봐도 유실이 없다.
    const msg = String(e.message || e);
    const limit = /LIMIT_EXCEEDED|daily scratch org signup limit/i.test(msg);
    console.error(`  scratch 생성 실패 — ${limit ? 'Dev Hub 일일 scratch 한도 소진 (당일 재시도 없음)' : msg.slice(0, 120)}`);
    return { error: 'scratch-create' };
  }
  try {
    // 시드 — 이름 고정 (diff 노이즈 방지). 레코드 페이지·리스트뷰·즐겨찾기 검색창 조건용.
    const ids = [];
    for (let i = 1; i <= 10; i += 1) {
      const r = sf(['data', 'create', 'record', '--sobject', 'Account', '--values',
        `Name='UI Probe Account ${String(i).padStart(2, '0')}'`, '-o', ALIAS], { lenient: true });
      if (r && r.id) ids.push(r.id);
    }
    console.log(`  시드 Account ${ids.length}건`);
    // 즐겨찾기 시딩 — ui-api REST (드롭다운·검색창이 항목이 있어야 열린다)
    for (const id of ids) {
      try {
        execFileSync('sf', ['api', 'request', 'rest', '/ui-api/favorites', '--method', 'POST', '--body',
          JSON.stringify({ targetType: 'Record', target: id }), '-o', ALIAS],
          { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 });
      } catch { /* 즐겨찾기 상한·중복은 무시 */ }
    }
    const surfaces = SURFACES.map(s => ({ ...s }));
    surfaces.find(s => s.name === 'record-page-account').path =
      ids.length ? `/lightning/r/Account/${ids[0]}/view` : '/lightning/o/Account/home';
    return await collectTrack({ org: ALIAS, surfaces, mode: 'full', tag: '' });
  } catch (e) {
    console.error(`  scratch 트랙 수집 실패 — ${String(e.message).slice(0, 120)}`);
    return { error: String(e.message) };
  } finally {
    if (!KEEP) {
      try { sf(['org', 'delete', 'scratch', '-o', ALIAS, '--no-prompt']); console.log('  scratch 삭제'); }
      catch { console.error('  scratch 삭제 실패 — sf org delete scratch -o ' + ALIAS); }
    }
  }
}

/** 조회 전용 트랙 수집 — diff 는 하지 않는다 (병렬 수집 뒤 순차 diff). */
async function collectReadOnly({ key, org, tag }) {
  console.log(`  ${key} 트랙: ${org} (조회 전용)`);
  let recPath = '/lightning/o/Account/home';
  let recId = null;
  try {
    // ORDER BY 에 Id 타이브레이커 필수 (2026-08-31 실측). CreatedDate 만으로 정렬하면
    // 동점 그룹에서 서버가 아무거나 주고, 뽑히는 레코드가 바뀌면 표면 전체가 유령 diff 로
    // 뜬다 — 데모 org 는 시드가 한 번에 들어가 최소 CreatedDate 동점자가 91개,
    // person·business account 가 섞여 있어 필드 세트가 통째로 갈린다. 실측: 보름 넘게
    // person 계정이 뽑히다 어느 날 business 계정이 뽑혀 +15/-18 이 났고 둘의
    // CreatedDate 는 같았다. Id 를 붙이면 그 그룹에서 항상 같은
    // 레코드가 나온다 (고객 트랙 org 의 동점 2개도 같은 방식으로 고정).
    const q = sf(['data', 'query', '-q', 'SELECT Id FROM Account ORDER BY CreatedDate, Id LIMIT 1', '-o', org], { lenient: true });
    const id = q && q.records && q.records[0] && q.records[0].Id;
    if (id) { recId = id; recPath = `/lightning/r/Account/${id}/view`; }
  } catch { /* 조회 실패는 목록 화면으로 폴백 */ }
  console.log(`    ${key} 감시 레코드: ${recId || '(조회 실패 — 목록 화면 폴백)'}`);
  const surfaces = SURFACES.map(x => ({ ...x }));
  surfaces.find(x => x.name === 'record-page-account').path = recPath;
  try {
    const r = await collectTrack({ org, surfaces, mode: 'controls', tag });
    return { ...r, recordId: recId };
  } catch (e) {
    console.error(`  ${key} 트랙 수집 실패 — ${String(e.message).slice(0, 120)}`);
    return { error: String(e.message), recordId: recId };
  }
}

const tAll = Date.now();
const [scratchRes, licenseRes, customerRes] = await Promise.all([
  RUN_SCRATCH ? collectScratch() : Promise.resolve(null),
  RUN_LICENSE ? collectReadOnly({ key: 'license', org: LICENSE_ORG, tag: 'lic-' }) : Promise.resolve(null),
  RUN_CUSTOMER ? collectReadOnly({ key: 'customer', org: CUSTOMER_ORG, tag: 'cust-' }) : Promise.resolve(null)
]);
console.log(`  수집 완료 (3트랙 병렬 ${Math.round((Date.now() - tAll) / 1000)}초) — diff 시작`);

// ── 트랙 A diff: scratch (중립 기준선) ─────────────────
if (scratchRes && !scratchRes.error) {
  scratchSignatures = scratchRes.signatures;
  scratchStructural = scratchRes.structurals;
  const r = diffTrack({
    track: 'scratch', org: 'scratch(developer)', license: 'none',
    prevSurfaces: (prevTracks.scratch || {}).surfaces || null,
    signatures: scratchRes.signatures, screenshots: scratchRes.screenshots, evidencePrefix: ''
  });
  tracks.scratch = { org: 'scratch(developer)', license: 'none', surfaces: r.kept, structural: scratchRes.structurals };
  totalChanges += r.changes;
  if (r.failed) exitCode = 3;
} else {
  // scratch 를 안 돌린 경우(--only-license · 생성 실패) 이전 스냅샷을 그대로 보존한다 —
  // 트랙 하나가 못 돌았다고 다른 트랙 기준선을 잃으면 안 된다.
  if (scratchRes && scratchRes.error) exitCode = 3;
  tracks.scratch = prevTracks.scratch || null;
  scratchSignatures = (prevTracks.scratch || {}).surfaces || null;
  scratchStructural = (prevTracks.scratch || {}).structural || null;
}

// ── 트랙 B diff: 라이선스 org — 게이트 판별은 diff **전에** ──
let licenseStructural = null;
if (licenseRes && !licenseRes.error) {
  // 게이트 판별은 **구조 시그니처**로 한다 — 라벨은 org 언어가 달라 비교가 성립하지 않는다.
  // 전역 크롬(모든 표면 공통 = 헤더·유틸리티 바)을 뺀 뒤 화이트리스트로 좁힌다.
  // scratch 기준선이 비면 차집합이 전부 gated 로 보이므로 그때는 판별을 건너뛴다.
  const haveBaseline = GATE_CHECK && scratchStructural && Object.values(scratchStructural).some(v => v && v.length);
  const gatedBySurface = {};
  if (haveBaseline) {
    const base = stripGlobalChrome(scratchStructural);
    const lic = stripGlobalChrome(licenseRes.structurals);
    for (const name of Object.keys(lic)) gatedBySurface[name] = splitLicenseGated(gateCandidates(lic[name]), base).gated;
    const total = Object.values(gatedBySurface).reduce((a, v) => a + v.length, 0);
    console.log(`  게이트 판별(scratch 대비): 소 org 에 없는 식별자 ${total}개 / 후보 ${Object.values(lic).map(gateCandidates).flat().length}개`);
  } else {
    console.log(`  ⚠ scratch 대비 게이트 판별 건너뜀 — ${GATE_CHECK ? 'scratch 구조 기준선 없음' : '--no-gate-check'}`);
  }
  const r = diffTrack({
    track: 'license', org: LICENSE_ORG, license: LICENSE_LABEL,
    prevSurfaces: (prevTracks.license || {}).surfaces || null,
    signatures: licenseRes.signatures, structurals: licenseRes.structurals, screenshots: licenseRes.screenshots,
    evidencePrefix: 'lic-', gateCheck: haveBaseline ? name => gatedBySurface[name] || [] : null
  });
  licenseStructural = licenseRes.structurals;
  tracks.license = { org: LICENSE_ORG, license: LICENSE_LABEL, recordId: licenseRes.recordId || null, surfaces: r.kept, structural: licenseRes.structurals };
  totalChanges += r.changes;
  if (r.failed) exitCode = 3;
} else if (licenseRes && licenseRes.error) {
  tracks.license = prevTracks.license || null;   // 스냅샷 보존 (수집 실패로 기준선을 잃지 않는다)
  licenseStructural = (prevTracks.license || {}).structural || null;
  exitCode = 3;
} else if (prevTracks.license) {
  tracks.license = prevTracks.license;
  licenseStructural = prevTracks.license.structural || null;
}

// ── 트랙 C diff: 고객 org 급 ────────────────────────
// 이 트랙의 산출물은 **"아직 도착 안 한 기능"** 이다 — 라이선스 트랙에는 있는데
// 여기에는 없는 것. 데모 앱 목록보다 실무 가치가 높다 (2026-08-11 확정).
if (customerRes && !customerRes.error) {
  const r = diffTrack({
    track: 'customer', org: CUSTOMER_ORG, license: CUSTOMER_LABEL,
    prevSurfaces: (prevTracks.customer || {}).surfaces || null,
    signatures: customerRes.signatures, structurals: customerRes.structurals, screenshots: customerRes.screenshots,
    evidencePrefix: 'cust-', gateCheck: null
  });
  tracks.customer = { org: CUSTOMER_ORG, license: CUSTOMER_LABEL, recordId: customerRes.recordId || null, surfaces: r.kept, structural: customerRes.structurals };
  totalChanges += r.changes;
  if (r.failed) exitCode = 3;

  // 미도착 목록 — 라이선스 org 에는 있고 고객 org 급에는 없는 식별자
  if (licenseStructural && Object.values(licenseStructural).some(v => v && v.length)) {
    const licS = stripGlobalChrome(licenseStructural);
    const custS = stripGlobalChrome(customerRes.structurals);
    const pending = [];
    for (const name of Object.keys(licS)) {
      for (const l of splitLicenseGated(gateCandidates(licS[name]), custS).gated) pending.push(`${name} :: ${l}`);
    }
    const uniq = [...new Set(pending)];
    console.log(`  미도착 판별(고객 org 대비): ${uniq.length}개 — 라이선스 org 에는 있고 ${CUSTOMER_ORG} 에는 없다`);
    uniq.slice(0, 8).forEach(l => console.log(`     · ${l}`));
    const evid = resolve(CONTENT, 'org-evidence', 'ui-pending-arrival');
    mkdirSync(evid, { recursive: true });
    writeFileSync(resolve(evid, 'pending.json'), JSON.stringify({
      note: '라이선스 org 에는 있고 고객 org 급에는 아직 없는 식별자. 도착하는 날이 카드 후보다.',
      licenseOrg: LICENSE_ORG, customerOrg: CUSTOMER_ORG, items: uniq
    }, null, 2) + '\n');
  }
} else if (customerRes && customerRes.error) {
  tracks.customer = prevTracks.customer || null;
  exitCode = 3;
} else if (prevTracks.customer) {
  tracks.customer = prevTracks.customer;
}

for (const k of Object.keys(tracks)) if (!tracks[k]) delete tracks[k];
writeJson(SNAP, {
  note: '표면별 컨트롤 시그니처 — 텍스트 diff 로 UI 변화를 잡는다. 숫자는 # 마스킹. 트랙 2개: scratch(중립 기준선) · license(라이선스 게이트 감시). 두 트랙 차집합이 게이트 판별기다.',
  tracks
});
const surfaceCount = Object.entries(tracks).map(([k, v]) => `${k} ${Object.keys(v.surfaces || {}).length}면`).join(' · ');
console.log(`\ncontent/ui-surfaces.json (${surfaceCount} · 변화 ${totalChanges}면)`);
process.exit(exitCode);
