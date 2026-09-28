/**
 * 카드 3장 렌더 — 각각 다른 모션의 마스코트를 쓴다.
 *
 *   node bin/fetch-release-notes.mjs   (본문 수집, 1회)
 *   node bin/render-cards.mjs          → out/cards/*.html + out/cards-gallery.html
 *
 * 1  deepdive-release-update   alert   양팔 올림 + 놀란 눈   기한 있는 릴리스 업데이트
 * 2  deepdive-retired          tumble  무너짐 + X 눈         이미 제거된 기능
 * 3  roundup-admin-dev         6종 각기 다른 자세 + wave 밴드
 *
 * 내용은 content/release-notes.json — help.salesforce.com 공식 원문이다.
 * 점수·fit 같은 내부 지표는 넣지 않는다. admin·developer가 찾는 것만 담는다:
 * 지금과 뭐가 다른가 / 어느 에디션인가 / Setup 어디를 누르나 / 뭘 해야 하나.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { writeJson } from './lib/io.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderMascot, renderLogo, viewBoxFor } = require(resolve(ROOT, 'design/brick-render.js'));
const { loadEditorialDataUri, loadEditorialIllustration } = require(resolve(ROOT, 'design/editorial-illustration.js'));
const NewsCard = require(resolve(ROOT, 'templates/card.js'));
const { renderGptDirectedCard } = require(resolve(ROOT, 'templates/gpt-directed-card.js'));
const { renderDynamicEditorialInfographic } = require(resolve(ROOT, 'templates/editorial-infographic-dynamic.js'));
const { loadBrief } = require(resolve(ROOT, 'templates/card-brief.js'));
const { computeLayout } = require(resolve(ROOT, 'templates/card-layout.js'));
const { renderEditorialInfographic } = require(resolve(ROOT, 'templates/editorial-infographic.js'));

const TOKENS = readFileSync(resolve(ROOT, 'design/tokens.css'), 'utf8');
const GPT_DIRECTED_CSS = readFileSync(resolve(ROOT, 'design/gpt-directed-card.css'), 'utf8');
const EDITORIAL_INFOGRAPHIC_CSS = readFileSync(resolve(ROOT, 'design/editorial-infographic.css'), 'utf8');
const EDITORIAL_DYNAMIC_CSS = readFileSync(resolve(ROOT, 'design/editorial-infographic-dynamic.css'), 'utf8');

const ANGLE = { ry: 24, rx: 14, depth: 4, ambient: 0.52 };
const BRICK = {
  brickHex: '#F7FAFB', blueHex: '#4997CF', eyeHex: '#0A0E12',
  outline: '#16212B', outlineWidth: 0.50
};
const BRICK_ON_DARK = { ...BRICK, outline: '#0A1017' };

// 히어로 마스코트는 자세별 타이트 viewBox 를 쓴다. 그룹 공통 viewBox 는 자세를
// 바꿔도 몸통이 안 튀게 하려던 것인데, 카드 한 장에 자세가 하나뿐이라 이득이 없고
// 자세에 따라 8~32% 가 빈 공간으로 남았다. 크기는 CSS 가 높이로 맞춘다.
//
// 밴드·roundup 은 여러 자세가 한 줄에 서므로 공통 viewBox 를 그대로 쓴다 —
// 거기서는 몸통 높이가 서로 어긋나면 줄이 들쭉날쭉해진다.
const mascot = (pose, expression, brick, id, tight) => renderMascot({
  pose, expression, blue: 'body', ...ANGLE,
  viewBox: tight ? null : viewBoxFor(pose, { blue: 'body', ...ANGLE }),
  ...(brick || BRICK), idPrefix: id
});
const logoMark = renderLogo({ brickHex: '#FFFFFF', blueHex: '#4997CF',
                              outline: '#3D4E5C', outlineWidth: 0.55 });

// ── 연출 배치 ────────────────────────────────────────────────
// 카드가 준 staging 배열을 렌더된 SVG 로 바꾼다. 판단은 이미 끝났고 여기서는
// 그리기만 한다 — 무인 09:30 실행에는 모델이 없으므로 판단이 여기 있으면 안 된다.
// 어디에 몇 마리를 세울지는 카드를 만드는 세션에서 정해 데이터로 남긴다.
const { planStaging, availableSlots } = require(resolve(ROOT, 'design/staging.js'));

const staged = (card, idPrefix) => {
  if (!card.staging) return null;
  const { items, warnings } = planStaging(card.staging, availableSlots(card));
  for (const w of warnings) console.warn(`  연출 경고 [${idPrefix}] ${w}`);
  const out = {};
  items.forEach((m, i) => {
    (out[m.at] ||= []).push({
      side: m.side,
      size: m.size,
      svg: mascot(m.pose, m.expr, m.at === 'band' ? BRICK_ON_DARK : BRICK,
                  idPrefix + i, m.tight)
    });
  });
  return out;
};

// 생성 장면은 사람이 세션에서 검수해 저장한 자산이다. 발송 시점에는 네트워크나 모델을
// 호출하지 않는다. 자산이 없으면 기존 SVG 마스코트가 카드 발송을 계속 보장한다.
const editorialIllustration = (file, alt) => {
  const path = resolve(ROOT, 'assets/editorial/3d', file);
  if (!existsSync(path)) return '';
  return loadEditorialIllustration(readFileSync, path, alt);
};
const editorialDataUri = file => {
  const path = resolve(ROOT, 'assets/editorial/3d', file);
  return existsSync(path) ? loadEditorialDataUri(readFileSync, path) : '';
};
const releaseUpdateHero = editorialIllustration(
  'release-update-alert.png',
  '릴리스 업데이트를 알리는 3D 브릭 빌더 마스코트'
) || mascot('alert', 'wide', BRICK, 'h1', true);
const gptDirectedBackground = editorialDataUri('gpt-directed-release-background.png');
const infographicBackground = (() => {
  const path = resolve(ROOT, 'assets/editorial/infographic/release-order-banner-background.png');
  return existsSync(path) ? loadEditorialDataUri(readFileSync, path) : '';
})();
const dynamicInfographicBackground = (() => {
  const path = resolve(ROOT, 'assets/editorial/infographic/release-order-dynamic-skin.png');
  return existsSync(path) ? loadEditorialDataUri(readFileSync, path) : '';
})();

// ═══ 1 · 릴리스 업데이트 (기한 있음) ════════════════════════
// 원문: rn_automate_flow_release_update_sort_apex_batch_action_result_by_request_order
const card1 = {
  badge: 'urgent', badgeLabel: '릴리스 업데이트', tone: 'urgent',
  cycle: "SUMMER '26 · 강제 적용 예정",
  applies: 'Flow에서 <b>Apex 배치 액션 결과를 순서대로</b> 쓰고 있다면',
  headline: '배치 결과 첫 줄이<br><em>더 이상 오류가 아닙니다</em>',
  lead: '지금은 실패한 요청이 위로 몰려서 <b>첫 결과만 봐도 오류를 잡을 수</b> 있었습니다. Summer ’26부터는 요청을 보낸 순서 그대로라 첫 줄이 성공일 수 있습니다.',
  compareTitle: '결과 정렬 방식이 달라진다',
  before: { when: '지금까지', what: '<b>오류가 난 요청이 맨 위</b>로 올라오고<br>성공한 요청이 아래에 정렬' },
  after: { when: 'Summer ’26부터', what: '<b>요청을 받은 순서</b> 그대로<br>결과가 표시' },
  editionNote: 'Lightning Experience · Classic 공통',
  editions: [
    { t: 'Lightning Experience', on: true }, { t: 'Salesforce Classic', on: true },
    { t: 'Enterprise' }, { t: 'Performance' }, { t: 'Unlimited' }, { t: 'Developer' }
  ],
  path: [{ t: 'Setup' }, { t: 'Quick Find', q: true }, { t: 'Release Updates' }],
  todo: [
    'Setup → Quick Find에 <code>Release Updates</code> 입력 후 선택',
    '목록에서 <b>Sort Apex Batch Action Results by Request Order</b> 찾기',
    '안내된 <b>테스트·활성화 단계</b>를 순서대로 진행',
    '<b>Trust Status</b>에서 우리 인스턴스의 메이저 릴리스 업그레이드 날짜 확인'
  ],
  warn: {
    kind: 'urgent', label: '강제',
    text: '릴리스 업데이트는 Salesforce가 정한 시점에 <b>자동으로 적용</b>됩니다. 지금 켜지 않아도 적용되니, 미리 켜서 영향을 확인하는 것이 목적입니다.'
  },
  cta: 'Summer ’26에 <em>자동 적용</em>',
  ctaSub: 'Trust Status에서 우리 인스턴스 날짜부터 확인하세요',
  height: 1620   // 갤러리 슬롯 계산용 근사치 — 실제 캡처는 측정값을 쓴다
};

// GPT Image 2가 만든 공간·패널·시선 흐름을 그대로 쓰는 비교 카드다. 텍스트는 원문
// 사실만 HTML이 넣어 모델의 한글·수치 오류를 막는다.
const gptDirectedReleaseCard = {
  label: 'GPT IMAGE 2 · VISUAL CONCEPT',
  title: '배치 결과 첫 줄이 더 이상 오류가 아닙니다',
  lead: 'Summer ’26부터 요청을 받은 순서대로 결과가 표시됩니다. 첫 결과만 보고 오류를 판단하던 Flow는 미리 확인해야 합니다.',
  before: '오류가 난 요청이 맨 위',
  after: '요청을 받은 순서 그대로',
  actions: [
    'Release Updates에서 미리 테스트',
    'Trust Status에서 업그레이드 날짜 확인'
  ],
  source: '공식 릴리스 노트 · SUMMER ’26'
};

const editorialInfographicCard = {
  title: '배치 결과 첫 줄이 더 이상 오류가 아닙니다',
  lead: '지금은 실패한 요청이 위로 보이지만, Summer ’26부터는 요청을 보낸 순서대로 결과가 표시됩니다.',
  panels: [
    { tone: 'blue', title: '무엇이 바뀌나요?', items: ['지금: 오류가 난 요청이 맨 위로 정렬', '변경: 요청을 받은 순서 그대로 표시', '첫 줄이 성공이어도 정상일 수 있음'] },
    { tone: 'green', title: '처리 흐름', steps: ['요청 보냄', 'Apex 배치 실행', '결과 표시'] },
    { tone: 'purple', title: 'Setup에서 확인', items: ['Setup → Quick Find → Release Updates', 'Sort Apex Batch Action Results by Request Order', '테스트 후 활성화'] },
    { tone: 'orange', title: '배포 전 체크', items: ['현재 Flow 결과 순서 캡처', '변경 후 결과와 비교', 'Trust Status에서 업그레이드 일정 확인'] }
  ],
  takeaway: 'Apex 배치 결과 정렬이 요청 순서로 바뀝니다',
  source: '공식 릴리스 노트 · Summer ’26'
};

const dynamicEditorialInfographicCard = {
  eyebrow: 'SUMMER ’26 · RELEASE UPDATE',
  title: '배치 결과 첫 줄이 더 이상 오류가 아닙니다',
  lead: '지금은 실패한 요청이 위로 보이지만 Summer ’26부터는 요청 순서대로 표시됩니다.',
  sections: [
    { tone: 'blue', type: 'compare', title: '무엇이 달라지나요?', rows: [['지금까지', '오류가 난 요청이 맨 위'], ['Summer ’26', '요청을 받은 순서 그대로']] },
    { tone: 'green', type: 'flow', title: '처리 흐름', steps: ['Flow 요청', 'Apex 배치 액션', '결과 표시'] },
    { tone: 'purple', type: 'list', title: 'Setup에서 확인', items: ['Setup → Quick Find → Release Updates', 'Sort Apex Batch Action Results by Request Order', '테스트·활성화 단계 진행'] },
    { tone: 'orange', type: 'list', title: '영향을 받는 경우', items: ['Flow가 Apex 배치 결과 순서를 전제로 할 때', '첫 결과가 성공이어도 정상일 수 있음', '현재 결과와 변경 후 결과를 비교'] },
    { tone: 'gold', type: 'list', title: '배포 전 체크', items: ['현재 Flow 결과 캡처', 'Release Updates에서 미리 테스트', 'Trust Status에서 업그레이드 날짜 확인'] },
    { tone: 'note', type: 'note', title: '핵심', body: 'Summer ’26부터 자동 적용됩니다. 지금 미리 테스트해 결과 순서에 대한 가정을 확인하세요.', source: '공식 릴리스 노트 · Summer ’26' }
  ]
};

// 브리프 실패는 이 카드 한 장의 문제다 — 폐기·이벤트·블로그 카드처럼 격리해서
// 낡은 브리프 하나가 무인 09:30 실행의 그날 발송 전체를 죽이지 않게 한다.
// 단, 브리프가 "존재하는데 무효"면 하드코딩 폴백으로도 안 돌아간다. 폴백은
// 낡은 내용을 그대로 내보내는 더 나쁜 실패라서, 이 카드만 조용히 빼고 계속 간다.
const handoffBriefPath = resolve(ROOT, 'out/card-brief.json');
let handoffBrief = null;
let handoffBackground = '';
let handoffBriefBroken = false;
if (existsSync(handoffBriefPath)) {
  try {
    const brief = loadBrief(readFileSync, handoffBriefPath);
    const assetPath = resolve(ROOT, brief.image.assetPath);
    if (!existsSync(assetPath)) throw new Error(`Claude 브리프가 지정한 GPT 배경을 찾을 수 없습니다: ${brief.image.assetPath}`);
    // full 모드는 코드가 텍스트를 얹지 않으므로 존 맵 수용량 게이트를 타지 않는다.
    if ((brief.image.layoutMode || 'skin') !== 'full') {
      const layout = computeLayout(brief.card.sections);
      if (!layout.fits) throw new Error(`섹션이 캔버스를 넘칩니다 — 예상 하단 ${layout.bottom}px`);
    }
    handoffBrief = brief;
    handoffBackground = loadEditorialDataUri(readFileSync, assetPath);
  } catch (error) {
    handoffBriefBroken = true;
    console.warn(`⚠ out/card-brief.json 무효 — 핸드오프 인포그래픽 카드를 건너뜁니다: ${error.message}`);
    // HTML 정리 루프는 .html만 지우므로 이전 실행의 PNG가 살아남는다. 발송기의
    // --infographic-concept --force 가 그 낡은 PNG를 집어 올리지 않게 함께 지운다.
    const stalePng = resolve(ROOT, 'out/cards/release-order-dynamic-infographic.png');
    if (existsSync(stalePng)) {
      unlinkSync(stalePng);
      console.warn('  이전 실행의 release-order-dynamic-infographic.png 삭제 — 무효 브리프의 산출물 잔존 방지');
    }
  }
}
const handoffLayoutMode = handoffBrief ? (handoffBrief.image.layoutMode || 'skin') : 'skin';
const handoffCard = handoffBrief
  ? { ...handoffBrief.card, eyebrow: handoffBrief.card.eyebrow || handoffBrief.source.label }
  : dynamicEditorialInfographicCard;

// ═══ 2 · 이미 제거된 기능 ═══════════════════════════════════
// 원문: rn_sra_scqa
const card2 = {
  badge: 'retired', badgeLabel: '이미 제거됨', tone: 'retired',
  cycle: '2026-06-30 제거 · 오늘 기준 적용 완료',
  applies: '케이스 페이지나 <b>Service Assistant 플랜 스텝</b>을 구축했다면',
  headline: '“요약 버튼 어디 갔어요”<br><em>문의가 올 수 있습니다</em>',
  headlineSmall: true,
  lead: 'Work Summaries for Case(Beta) 폐기로 <b>Summarize Case 퀵액션이 6월 30일 제거</b>됐습니다. 플랜 스텝·포스트·피드 탭에서 쓰던 버튼이라, 붙여둔 화면이 있으면 사용자가 먼저 알아챕니다.',
  compareTitle: '어디서 사라졌나',
  before: { when: '6월 29일까지', what: '플랜 스텝 · 포스트 · 피드 탭에서<br><b>케이스를 바로 요약</b>' },
  after: { when: '6월 30일부터', what: '퀵액션 제거<br><b>Enhanced Summaries</b> 컴포넌트로 대체' },
  editionNote: 'Agentforce 애드온 필요',
  editions: [
    { t: 'Lightning Experience', on: true }, { t: 'Enterprise' }, { t: 'Unlimited' },
    { t: '+ Einstein for Service', on: true }, { t: '+ Agentforce for Service', on: true },
    { t: '+ Agentforce 1', on: true }
  ],
  todo: [
    '<b>Enhanced Case Summaries</b> 활성화',
    '케이스 레코드 페이지에 <b>Enhanced Summaries</b> 컴포넌트 추가',
    'Summarize Case 프롬프트 템플릿 버전을 만들고 Service Assistant 전용 프롬프트 텍스트 추가',
    '<code>getPlanDataEnhanced.servicePlanInfo</code> invocable action 연결'
  ],
  warn: {
    kind: 'info', label: '유지',
    text: 'Summarize Case 프롬프트 템플릿에 포함된 <b>invocable action은 계속 지원</b>됩니다. 새 컴포넌트에서 그대로 재사용할 수 있습니다.'
  },
  cta: '쓰던 화면이 <em>있는지</em> 확인',
  ctaSub: '플랜 스텝·피드 탭에 붙여둔 곳부터 찾으세요',
  height: 1620
};

// ═══ 4 · 가이던스 카드 (동작 변경) ═══════════════════════
// 앞의 카드들과 성격이 다르다. 1·2는 릴리스 노트 한 건을 옮긴 것이고,
// 이건 docs/guidance/2026-08-01-apex-secure-by-default.md 를 카드로 만든 것이다.
// 원문 두 건을 우리가 합쳐 해석한 결과라서, 카드의 값어치는 릴리스 노트에 없는
// 한 줄에 있다 — 날짜가 아니라 API 버전이 방아쇠다.
// ═══ 4+ · 동작 변경 카드 (큐레이션) ═══════════════════════
// bin/fetch-behavior-changes.mjs 가 후보를 잡고, 사람이 원문을 읽고 여기에 요약한다.
// 요약이 이 파이프라인의 값어치다 — 릴리스 노트에 없는 한 줄이 여기서 나온다.
// 항목을 늘릴 때는 이 배열에 넣기만 하면 된다. 렌더·발송은 자동이다.
const BEHAVIOR_CARDS = [
  {
    name: 'behavior-apex-secure',
    pose: ['alert', 'wide'], band: ['check', 'look'],
    fileTitle: '2026-08-01 API67 apex-secure-by-default',
    capWhat: '같은 코드가 보던 데이터를 못 보게 됩니다',
    capStatus: '기본값 변경', capCycle: 'API 67.0',
    links: [
      ['공식 원문 — Database Operations Run in User Mode by Default',
       'https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_default_user_mode.htm&language=en_US&type=5'],
      ['공식 원문 — Apex Classes Enforce Sharing Rules by Default',
       'https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_default_enforce_sharing.htm&language=en_US&type=5']
    ],
    card: {
      badge: 'urgent', badgeLabel: '기본값 변경', tone: 'urgent',
      cycle: 'API 67.0 · 날짜 기한 없음',
      applies: '<b>Apex 클래스에 sharing 선언이 없는 프로젝트</b>',
      headline: '같은 코드가<br><em>보던 데이터를 못 보게</em> 됩니다',
      headlineSmall: true,
      lead: '날짜가 아니라 <b>API 버전이 방아쇠</b>입니다. <code>sourceApiVersion</code>을 올리는 순간 적용됩니다.',
      compareTitle: 'API 버전이 넘어가면',
      before: { when: 'API 66.0 이하', what: '선언 없는 클래스가 <b>모든 레코드</b>를 본다' +
        '<span class="recs"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></span>' },
      after: { when: 'API 67.0 이상', what: '<b>사용자가 볼 수 있는 것</b>만 본다' +
        '<span class="recs"><span></span><span></span><span></span><span class="off"></span><span class="off"></span><span class="off"></span><span class="off"></span><span class="off"></span></span>' },
      todo: [
        '클래스에 <b>with · without sharing 을 명시</b>한다 — 버전이 올라가도 동작이 안 변한다',
        '<code>WITH SECURITY_ENFORCED</code> 를 <code>WITH USER_MODE</code> 로 교체한다 — 안 하면 67.0에서 <b>컴파일 실패</b>'
      ],
      cta: '먼저 볼 곳 — <em>배치 · 통합 · Guest User</em>',
      ctaSub: '관리자 권한을 전제로 만든 코드가 사용자 모드에서 레코드를 못 찾습니다',
      srcTop: '출처 · 공식 릴리스 노트 2건', srcSub: 'help.salesforce.com',
      // 반응 → 관찰 → 배웅. 레코드 8개가 3개로 줄어드는 그 사이에서 지켜본다.
      staging: [
        { at: 'hero', side: 'right', pose: 'alert', expr: 'wide', size: 'lg' },
        { at: 'compare', side: 'mid', pose: 'lean', expr: 'look', size: 'sm' },
        { at: 'band', side: 'left', pose: 'check', expr: 'look' }
      ],
      height: 1000
    }
  },
  {
    name: 'behavior-oauth-unpw',
    pose: ['tumble', 'dead'], band: ['base', 'skeptical'],
    fileTitle: '2027-02-20 oauth-username-password-flow-retirement',
    capWhat: 'username-password 로 붙인 연동이 전부 멈춥니다',
    capStatus: '없어진다', capCycle: '2027-02-20',
    links: [
      ['공식 원문 — Retirement of OAuth 2.0 Username-Password Flow for Connected Apps',
       'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_unpw_flow_retirement.htm&language=en_US&type=5']
    ],
    card: {
      badge: 'retired', badgeLabel: '없어진다', tone: 'retired',
      cycle: '2027-02-20 강제 적용',
      applies: '<b>username-password 방식으로 붙인 연동</b>이 있다면',
      headline: '이 방식 쓰는 연동은<br><em>전부 멈춥니다</em>',
      headlineSmall: true,
      lead: '아이디·비밀번호를 HTTP 요청에 그대로 실어 보내는 방식이라 막습니다. <b>한 번 연기된 일정</b>입니다 — Winter ’27 예정이었다가 날짜가 바뀌었습니다.',
      compareTitle: '언제 끊기나',
      figure: {
        kind: 'timeline',
        fromLabel: '오늘', fromNote: 'username-password 로 계속 붙는다',
        gap: '남은 기간 <b>약 1년 6개월</b><br>Winter ’27 예정이었다가 한 번 연기됐다',
        toLabel: '2027-02-20', toNote: '이 방식 쓰는 연동이 전부 실패'
      },
      todo: [
        'Setup ▸ Release Updates 에 이 항목이 <b>안 보이면 해당 없음</b> — 이미 차단된 org다',
        '보이면 연동을 <b>web-server(PKCE)</b> 또는 <b>client credentials</b> 로 바꾼다'
      ],
      cta: '연동을 만든 곳이 <em>외부 업체</em>라면',
      ctaSub: '교체 협의에 시간이 더 듭니다 — 일정부터 잡아두세요',
      srcTop: '출처 · 공식 릴리스 노트', srcSub: 'help.salesforce.com',
      // 반응 → 지목 → 배웅. 타임라인 오른쪽 끝(2027-02-20)에 서서 닥칠 날을 가리킨다.
      staging: [
        { at: 'hero', side: 'right', pose: 'tumble', expr: 'dead', size: 'lg' },
        { at: 'figure', side: 'right', pose: 'point', expr: 'look', size: 'md' },
        { at: 'band', side: 'left', pose: 'base', expr: 'skeptical' }
      ],
      height: 980
    }
  },
  {
    name: 'behavior-agentforce-auto',
    // 헤드라인이 'Agentforce가 이번 달에 자동으로 켜집니다' 로 길다.
    // 마스코트를 옆에 두면 두 줄이 좁아져 읽는 속도가 떨어진다 → 밴드에만 둔다.
    // 밴드는 높이가 고정이라 big 그룹(jump·tumble)을 쓰면 위가 잘린다. calm 만.
    pose: null, band: ['wave', 'happy'],
    fileTitle: '2026-08 agentforce-platform-enabled-by-default',
    capWhat: 'Agentforce가 이번 달에 자동으로 켜집니다',
    capStatus: '자동 활성화', capCycle: '2026년 8월',
    links: [
      ['공식 원문 — Agentforce Platform Enabled by Default Starting August 2026',
       'https://help.salesforce.com/s/articleView?id=release-notes.rn_agentforce_auto_enable.htm&language=en_US&type=5']
    ],
    card: {
      badge: 'official', badgeLabel: '자동 활성화',
      cycle: '2026년 8월 중 · 이번 달',
      applies: '<b>Agentforce 접근 권한이 있는 모든 org</b>',
      headline: 'Agentforce가<br><em>이번 달에 자동으로</em> 켜집니다',
      headlineSmall: true,
      lead: 'Setup의 <b>Agentforce 토글이 사라집니다.</b> 추가 비용과 과금 변경은 없습니다.',
      compareTitle: 'Setup 화면이 달라진다',
      figure: {
        kind: 'toggle',
        name: 'Agentforce',
        before: { when: '지금', note: '<b>토글을 켜야</b> 쓸 수 있다' },
        after: { when: '8월 말부터', note: '토글이 <b>사라지고</b> 항상 켜져 있다' }
      },
      todo: [
        'Einstein 생성형 AI가 켜져 있으면 관리자는 <b>바로 Agentforce Builder</b>에 접근한다',
        '다른 사용자에게 열려면 <b>Manage AI Agents</b> 권한을 부여한다'
      ],
      cta: '이번 달 안에 <em>바뀝니다</em>',
      ctaSub: 'Setup 화면이 달라지니 운영 담당이 먼저 알아야 합니다',
      srcTop: '출처 · 공식 릴리스 노트', srcSub: 'help.salesforce.com',
      // 히어로를 비운다 — 헤드라인이 길어 옆에 두면 세 줄이 된다. 대신 토글이
      // 사라지는 자리 옆에 서서 지켜본다. 카드마다 마스코트가 다른 데 있는 게 낫다.
      staging: [
        { at: 'figure', side: 'right', pose: 'lean', expr: 'look', size: 'md' },
        { at: 'band', side: 'left', pose: 'wave', expr: 'happy' }
      ],
      height: 980
    }
  },
  {
    name: 'behavior-mfa-identity',
    pose: ['lean', 'look'], band: ['base', 'skeptical'],
    fileTitle: '2026-08-01 mfa-identity-verification-required',
    capWhat: '인증수단 추가할 때 본인 확인이 먼저 필요합니다',
    capStatus: '자동 적용', capCycle: 'MFA 강제 시행 시점',
    links: [
      ['공식 원문 — Identity Verification Is Required to Register New MFA Verification Methods',
       'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_mfa_identity_verification.htm&language=en_US&type=5']
    ],
    card: {
      badge: 'urgent', badgeLabel: '자동 적용', tone: 'urgent',
      cycle: 'MFA 강제 시행 시점',
      applies: '<b>MFA 강제 시행이 적용되는 org</b>',
      headline: '인증수단 추가할 때<br><em>본인 확인이 먼저</em> 필요합니다',
      headlineSmall: true,
      lead: '“MFA 등록 시 본인 확인 요구” 설정이 <b>자동으로 켜지고 회색 처리</b>됩니다. 조직에서 끌 수 없고 Salesforce 지원에 연락해야 합니다.',
      compareTitle: '등록 절차에 한 단계가 는다',
      figure: {
        kind: 'flow',
        before: { when: '지금', steps: ['등록 요청', '새 수단 등록'] },
        after: { when: '적용 후', steps: ['등록 요청', { t: '기존 수단으로 본인 확인', added: true }, '새 수단 등록'] }
      },
      todo: [
        '본인 확인 순서는 <b>Passkey</b>(Touch ID · Face ID · Windows Hello · 보안 키) → <b>Salesforce Authenticator</b> 순이다',
        '설정 위치는 <b>Setup ▸ Identity Verification</b> — 자동 활성화되고 회색 처리된다'
      ],
      cta: '시점은 org마다 <em>다릅니다</em>',
      ctaSub: 'MFA 강제 시행 일정이 org에 적용되는 시점에 함께 켜집니다',
      srcTop: '출처 · 공식 릴리스 노트', srcSub: 'help.salesforce.com',
      // 흐름 왼쪽에서 지목한다 — 새로 끼는 단계가 어디인지가 이 카드의 핵심이다.
      // 앞의 세 장과 자리가 겹치지 않게 왼쪽을 쓴다.
      staging: [
        { at: 'hero', side: 'right', pose: 'lean', expr: 'look', size: 'lg' },
        { at: 'figure', side: 'left', pose: 'point', expr: 'look', size: 'md' },
        { at: 'band', side: 'left', pose: 'base', expr: 'skeptical' }
      ],
      height: 1000
    }
  }
];

// ═══ 3 · admin·developer 실무 요약 6건 ══════════════════════
const items = [
  { badge: 'urgent', badgeLabel: '기한', tone: 'urgent', pose: 'alert', expr: 'wide',
    title: 'Apex 배치 결과 정렬 변경',
    sum: '오류 요청을 위로 올리던 정렬이 <b>요청 받은 순서</b>로 바뀝니다.',
    meta: 'Enterprise·Performance·Unlimited·Developer · Summer ’26 강제',
    doLabel: '지금', doText: 'Release Updates에서 테스트·활성화' },

  { badge: 'retired', badgeLabel: '제거', tone: 'retired', pose: 'tumble', expr: 'dead',
    title: 'Summarize Case 퀵액션 제거',
    sum: '플랜 스텝에서 케이스 직접 요약이 안 됩니다. <b>Enhanced Summaries</b>로 대체.',
    meta: 'Enterprise·Unlimited + Agentforce 애드온 · 2026-06-30',
    doLabel: '대체', doText: 'Enhanced Summaries 컴포넌트 추가' },

  { badge: 'official', badgeLabel: '신규', pose: 'jump', expr: 'happy',
    title: 'Scheduling 에이전트, 이메일까지',
    sum: 'Scheduling 에이전트를 <b>Email-to-Case</b>에 연결해 이메일로 고객 응대.',
    meta: 'Field Service / Einstein 1 / Agentforce 1 계열 · 2026-06-09부터',
    doLabel: '신규', doText: 'Legacy Agentforce Builder에서 연결' },

  { badge: 'official', badgeLabel: '개발 편의', pose: 'check', expr: 'happy',
    title: 'Apex 입력값을 패널에서 직접',
    sum: 'Apex-defined 입력 필드를 액션 패널에서 <b>바로 입력</b>. 변수 따로 안 만들어도 됩니다.',
    meta: 'Essentials~Developer 전 에디션 · Complex Type Configurator 기본값',
    doLabel: '확인', doText: 'Flow Builder 액션에서 필드 직접 입력' },

  { badge: 'official', badgeLabel: '배포', pose: 'point', expr: 'look',
    title: '이메일 템플릿 참조가 유지됩니다',
    sum: 'Send Email 액션이 템플릿을 <b>참조로 저장</b>해 환경 간 배포에서 안 깨집니다.',
    meta: 'Essentials~Developer · Action Version 3.0.1 필요',
    doLabel: '업데이트', doText: 'Send Email 액션을 3.0.1로 올리기' },

  { badge: 'official', badgeLabel: '보안', pose: 'lean', expr: 'look',
    title: 'Agentforce 이메일 권한 축소',
    sum: 'Automated Case User의 <b>Customize Application 권한 요구가 제거</b>됐습니다.',
    meta: 'Service Email · 최소 권한 원칙',
    doLabel: '정리', doText: 'Support Settings에서 해당 권한 회수' }
];

const card3 = {
  badge: 'official', badgeLabel: 'ADMIN · DEV',
  cycle: "SUMMER '26 · 2026-07-30 KST 기준",
  headline: '지금 적용된 Summer ’26,<br><em>admin·developer</em>가 볼 것',
  lead: '공식 릴리스 노트에서 Setup 경로와 해야 할 일이 있는 항목만 추렸습니다. 5건은 이미 적용됐고 1건은 기한이 있습니다.',
  listTitle: '항목별로 해야 할 일',
  items,
  warn: {
    kind: 'info', label: '오늘 기준',
    text: '<b>2번은 6월 30일에 이미 제거</b>됐고 <b>3번은 6월 9일부터 사용 가능</b>합니다. 1번만 Summer ’26에 강제 적용될 예정입니다.'
  },
  paths: [
    { label: '릴리스 업데이트 테스트·활성화 (1번)',
      segs: [{ t: 'Setup' }, { t: 'Quick Find', q: true }, { t: 'Release Updates' }] },
    { label: 'Automated Case User 권한 확인 (6번)',
      segs: [{ t: 'Setup' }, { t: 'Quick Find', q: true }, { t: 'Support Settings' },
             { t: 'Automated Case User' }] }
  ],
  cta: '이미 적용 <em>5건</em> · 기한 1건',
  ctaSub: '기한 있는 1번부터 손대는 게 순서입니다',
  srcTop: '출처 · 공식 릴리스 노트',
  srcSub: 'help.salesforce.com',
  height: 1500
};

// ═══ 4 · 교육·웨비나 (자동 수집) ═════════════════════════════
// bin/fetch-events.mjs 가 만든 content/events.json 을 읽어 예정 행사마다
// event 포스터를 만든다. 예전에는 SFMC 행사 한 장이 하드코딩돼 있었다 —
// 지금은 수집이 자동이고, 사람이 원문을 읽고 채운 어젠다·대상 같은 보강 내용은
// URL 키로 여기 남긴다. 자동 수집은 이 필드를 지어내지 않는다 (없으면 섹션이 빠진다).
const CURATED_EVENTS = {
  // 원문 오타 교정만 — salesforce.com/kr/events 페이지가 "극대화히는지"로 게시돼 있다.
  // 수집기는 원문을 그대로 담는 게 맞고, 사외 카드에 오타를 내보내지 않는 건 여기서 한다.
  'https://www.tableau.com/ko-kr/community/events/datafam/': {
    lead: 'AI와 데이터 분석 플랫폼이 결합된 에이전틱 분석이 어떻게 여러분의 업무 방식을 바꾸고 기업의 생산성을 극대화하는지, 그 강력한 분석의 미래를 소개합니다.'
  },
  'https://trailblazercommunitygroups.com/events/details/salesforce-salesforce-marketer-group-seoul-south-korea-presents-beyond-the-basics-hangyereul-neomeoseoneun-sfmc-gogeub-keoseuteomaijing-jeonryag/': {
    headline: 'SFMC 표준 기능의 한계,<br><em>스크립팅으로</em> 넘기',
    lead: 'Beyond the Basics — 한계를 넘어서는 SFMC 고급 커스터마이징 전략.',
    // 'SFMC 마케터<br>· 엔지니어' 로 두면 둘째 줄이 중점으로 시작해 어색했다.
    // 짧은 대상 유형을 굵게 한 줄로 두고, 한정 조건은 아래 설명으로 내린다.
    who: { big: '마케터 · 엔지니어',
           sub: 'SFMC 표준 기능만으로 안 풀리는 시나리오를 만난 사람' },
    agendaNote: '3개 세션',
    agenda: [
      ['AMPscript 고급 스크립팅', '복잡한 개인화 로직을 동적 콘텐츠로 구현'],
      ['데이터 파이프라인 최적화', 'Salesforce Lightning Platform 연동 · 실시간 데이터 전략'],
      ['Server-Side JS 활용', '웹 언어와 SSJS로 Cloudpage 고도화']
    ],
    where: { big: '오프라인', small: '마루360 성장 세미나룸',
             sub: '서울 역삼로 172, 역삼동 06248' }
  }
};

// ═══ 5 · 폐기 목록 변화 (자동 생성) ═════════════════════════
// 위 카드 1~4는 사람이 원문을 읽고 쓴 것이다. 이 카드는 다르다 —
// content/retirement-changes.json 을 그대로 카드로 옮긴다.
//
// deepdive 가 아니라 roundup 을 쓰는 이유: deepdive 는 before/after·todo·editions
// 처럼 원문을 읽어야 채울 수 있는 필드를 요구한다. 폐기 목록에서 얻는 것은
// (제품명, 시점, 이벤트 유형, D-day) 뿐이라 목록형이 맞다. 1건이어도 목록으로 낸다.
const { decide } = require(resolve(ROOT, 'design/director.js'));

// 이벤트 유형별 라벨·행동. sum/doText 를 유형에서 만들어내므로 문장을 지어내지 않는다.
const RET_KIND = {
  removed: {
    badgeLabel: '계획 철회', tone: 'reversed',
    sum: v => `공식 폐기 목록에서 <b>사라졌습니다</b>. 직전 시점은 ${esc0(v.timing)} 였습니다.`,
    doLabel: '보류', doText: '진행 중이던 대체·마이그레이션 작업을 멈추고 재확인'
  },
  added: {
    badgeLabel: '신규 폐기', tone: 'retired',
    sum: v => `공식 폐기 목록에 <b>새로 올랐습니다</b>. 시점 ${esc0(v.timing)}.`,
    doLabel: '확인', doText: '우리 구축물·제안 목록에 쓰이는 곳이 있는지 조사'
  },
  changed: {
    badgeLabel: '시점 변경', tone: 'urgent',
    sum: v => `폐기 시점이 <b>${esc0(v.from)} → ${esc0(v.to)}</b> 로 바뀌었습니다.`,
    doLabel: '일정', doText: '대응 일정을 새 시점에 맞춰 조정'
  },
  soon: {
    badgeLabel: null,   // D-30 처럼 D-day를 라벨로 쓴다
    tone: 'urgent',
    sum: v => `<b>${esc0(v.date)}</b> 폐기 예정입니다. 남은 기간 ${v.dday}일.`,
    doLabel: '착수', doText: '대체 방안 확정 후 마이그레이션 착수'
  },
  // Release Update 신규 등재 — 폐기와 다른 유형이다. "안 하면 자동 적용".
  // enforcedIn 이 null 이면 시점을 쓰지 않는다. 릴리스 노트에 시점 문구가 없는
  // 경우가 실제로 있다(ICU Locale Formats). 억지로 채우면 오보가 된다.
  enforced: {
    badgeLabel: '신규 강제 변경', tone: 'urgent',
    sum: v => v.enforcedIn
      ? `<b>${esc0(v.enforcedIn)}</b> 에 자동 적용됩니다. 지금 켜서 영향을 확인할 수 있습니다.`
      : `자동 적용 예정입니다. 강제 시점은 공식 노트를 확인하세요.`,
    doLabel: '테스트', doText: 'Setup ▸ Release Updates 에서 미리 켜서 영향 확인'
  }
};

// 완전 이스케이프 셋 — 텍스트 노드는 물론 속성 안에 들어가도 안전해야 한다.
// 수집한 제목·요약이 그대로 들어오므로 " ' > 를 빼면 속성 주입 여지가 생긴다.
const esc0 = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Order End Date 는 "구독이 끝날 때" 라 공통 날짜가 없다. 판매 중단에 해당하고
// 파트너에게는 "제안하면 안 된다"가 행동이다 — 마이그레이션 일정과 다르다.
const isOrderEnd = t => /^order end date$/i.test(String(t || '').trim());

// 이미 보낸 항목을 빼기 위한 키. 항목 이름만으로는 부족하다 — 같은 항목이 나중에
// 다른 이벤트로 다시 나올 수 있다. Lightning Sync 가 7월에 시점 변경으로 나갔다가
// 9월에 철회되면 둘 다 보내야 한다. changed 는 값까지 넣는다. 시점이 또 바뀌면
// (2028 → 2029) 그것도 새 소식이기 때문이다.
const itemKey = (kind, v) => {
  const ev = { removed: 'reversed', changed: 'rescheduled', added: 'announced', soon: 'imminent' }[kind];
  return kind === 'changed'
    ? `${v.key}::${ev}::${String(v.to || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : `${v.key}::${ev}`;
};

// 발송 이력은 발송기가 쓰고 렌더러가 읽는다. 카드에 넣을 항목을 여기서 정해야
// 하기 때문이다 — 이미 보낸 항목이 섞이면 같은 소식이 다시 나간다.
// 공개본: 채널 ID 기본값을 두지 않는다. 발송 이력 키의 네임스페이스라 비어 있으면 중복 발송이 난다.
const CH = process.env.SLACK_CHANNEL || '';
// --ignore-sent : 발송 이력을 무시하고 "전부 미발송"으로 렌더한다. 미리보기·재발송용.
//   이 옵션이 없던 동안은 out/sent.json 을 mv 로 치우고 렌더한 뒤 되돌렸다.
//   그러다 중간에 명령이 끊겨 이력이 .bak 에 남고 새 파일이 생겼다 — 하마터면
//   이미 보낸 카드 전부가 다음 실행에 중복 발송될 상태였다. 이력 파일은 건드리지 않는다.
const IGNORE_SENT = process.argv.includes('--ignore-sent');

function sentItemKeys() {
  if (IGNORE_SENT) return new Set();
  if (!CH) { console.error('SLACK_CHANNEL 이 없습니다 — 발송 이력 대조에 필요합니다 (미리보기는 --ignore-sent).'); process.exit(1); }
  try {
    const j = JSON.parse(readFileSync(resolve(ROOT, 'out/sent.json'), 'utf8'));
    return new Set(Object.keys(j.retirementItems || {})
      .filter(k => k.startsWith(CH + '::'))
      .map(k => k.slice(CH.length + 2)));
  } catch { return new Set(); }   // 없으면 전부 미발송이다
}

function retirementItems(ch, already) {
  const out = [];
  const keys = [];
  const EVENT_TYPE = {
    removed: 'reversed', changed: 'rescheduled', added: 'announced', soon: 'imminent'
  };
  const push = (kind, v) => {
    const ik = itemKey(kind, v);
    if (already.has(ik)) return;   // 이미 보낸 항목은 카드에서 뺀다
    keys.push(ik);
    const k = RET_KIND[kind];
    const orderEnd = isOrderEnd(v.timing || v.to);
    const d = decide({ id: v.key, title: v.name, eventType: EVENT_TYPE[kind] });
    out.push({
      badge: d.badge, tone: k.tone, pose: d.pose, expr: d.expression,
      // Order End Date 는 날짜가 박힌 폐기와 성격이 다르다 — 판매 중단이다.
      badgeLabel: (kind === 'added' && orderEnd) ? '판매 중단' : (k.badgeLabel || `D-${v.dday}`),
      title: v.name,
      sum: k.sum(v),
      meta: orderEnd
        ? '판매 중단 — 구독 종료 시 폐기 · 신규 제안 불가'
        : `공식 폐기 목록 · ${esc0(v.timing || v.to)}`,
      doLabel: k.doLabel,
      doText: orderEnd && kind === 'added'
        ? '제안·견적 목록에서 제외하고 대체 제품 확인'
        : k.doText
    });
  };
  for (const v of ch.removed || []) push('removed', v);
  for (const v of ch.changed || []) push('changed', v);
  for (const v of ch.added || []) push('added', v);
  for (const v of ch.soon || []) push('soon', v);
  return { items: out, keys };
}

// Release Update 신규 항목 → 같은 카드에 합친다 (A안, 2026-07-30 확정).
// 별도 카드로 내면 발송량이 2배가 되고, 둘 다 "공식 목록이 바뀌었다"는
// 같은 성격이라 한 장에 묶는다.
//
//   - 대상은 added 만이다. removed 는 적용 완료·릴리스 이동이라 뉴스가 아니다
//   - retirementOverlap 이 있는 항목은 건너뛴다 — 폐기 목록과 같은 사건이다
//   - itemKey 는 ru:: 접두어로 네임스페이스를 분리한다. 폐기 항목과 키가
//     충돌하면 안 된다 (폐기 쪽은 지금처럼 접두어 없이 둔다)
function releaseUpdateItems(ru, already) {
  const out = [];
  const keys = [];
  let skippedOverlap = 0;
  for (const v of ru.added || []) {
    if (v.retirementOverlap) { skippedOverlap++; continue; }
    const ik = `ru::${v.key}::enforced`;
    if (already.has(ik)) continue;
    keys.push(ik);
    const k = RET_KIND.enforced;
    const d = decide({ id: v.key, title: v.name, eventType: 'enforced' });
    out.push({
      badge: d.badge, tone: k.tone, pose: d.pose, expr: d.expression,
      badgeLabel: k.badgeLabel,
      title: v.name,
      sum: k.sum(v),
      meta: v.enforcedIn
        ? `릴리스 업데이트 · ${esc0(v.enforcedIn)} 강제 적용`
        : '릴리스 업데이트 · 시점은 공식 노트 확인',
      doLabel: k.doLabel, doText: k.doText
    });
  }
  return { items: out, keys, skippedOverlap };
}

let card5 = null, ret5 = [], ret5Keys = [];
try {
  const ch = JSON.parse(readFileSync(resolve(ROOT, 'content/retirement-changes.json'), 'utf8'));
  // Release Update 변화 파일은 없어도 된다 — 폐기 카드 생성을 막지 않는다.
  let ru = { added: [] };
  try {
    ru = JSON.parse(readFileSync(resolve(ROOT, 'content/release-update-changes.json'), 'utf8'));
  } catch { /* 없으면 폐기 항목만으로 진행 */ }

  const already = sentItemKeys();
  ({ items: ret5, keys: ret5Keys } = retirementItems(ch, already));
  const ruRes = releaseUpdateItems(ru, already);
  ret5 = ret5.concat(ruRes.items);
  ret5Keys = ret5Keys.concat(ruRes.keys);
  if (ruRes.skippedOverlap) {
    console.log(`\nRelease Update ${ruRes.skippedOverlap}건은 폐기 목록과 같은 사건 — 카드에서 뺐습니다.`);
  }

  const totalIn = (ch.removed || []).length + (ch.changed || []).length +
                  (ch.added || []).length + (ch.soon || []).length +
                  (ru.added || []).filter(v => !v.retirementOverlap).length;
  if (totalIn && !ret5.length) {
    console.log(`\n폐기 카드 생략 — ${totalIn}건 전부 이미 발송된 항목입니다.`);
  }
  if (ret5.length) {
    if (totalIn > ret5.length) {
      console.log(`\n대상 항목 ${totalIn}건 중 ${totalIn - ret5.length}건은 이미 발송 — ${ret5.length}건만 카드에 넣습니다.`);
    }
    // 카드 배지·헤드라인은 카드에 실제로 들어간 항목으로 정한다. 이미 발송된
    // 철회 때문에 "철회됐습니다" 헤드라인이 또 나오면 안 된다.
    const nRev = ret5.filter(i => i.badge === 'reversed').length;
    const nSoon = ret5.filter(i => /^D-/.test(i.badgeLabel)).length;
    const nEnf = ret5.filter(i => i.badgeLabel === '신규 강제 변경').length;
    // 임박만·강제만 있으면 urgent 다. retired(회색)는 "이미 죽었다"는 색이라
    // "한 달 뒤에 없어진다 / 곧 자동 적용된다"는 경고에 맞지 않는다.
    // 철회가 섞이면 그게 가장 큰 소식이라 우선한다.
    const tone5 = nRev ? 'reversed'
      : (nSoon === ret5.length || nEnf === ret5.length) ? 'urgent' : 'retired';
    // lead 는 실제로 들어간 항목의 소스를 말한다. 강제 변경만 있는데
    // "폐기 목록에서 감지"라고 쓰면 오보다.
    const leadRet = 'Salesforce 공식 폐기 목록(KB 000381744)에서 감지한 변화입니다. ' +
                    '이 목록은 Salesforce가 고객 영향이 있다고 판정한 폐기만 싣습니다.';
    const leadEnf = 'Salesforce 릴리스 업데이트 목록에서 감지한 신규 강제 변경입니다. ' +
                    '관리자가 아무것도 하지 않아도 정해진 릴리스에 자동 적용됩니다.';
    const leadMix = 'Salesforce 공식 폐기 목록(KB 000381744)과 릴리스 업데이트 목록에서 ' +
                    '감지한 변화입니다. 폐기는 고객 영향이 있다고 판정된 것만 실리고, ' +
                    '릴리스 업데이트는 강제 시점에 자동 적용됩니다.';
    card5 = {
      badge: tone5,
      tone: tone5,   // 헤드라인 강조색을 배지와 맞춘다
      badgeLabel: nEnf === ret5.length ? '릴리스 업데이트' : '폐기 목록',
      cycle: `공식 목록 감시 · ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)} KST 기준`,
      headline: nRev
        ? '폐기 계획이<br><em>철회</em>됐습니다'
        : nSoon === ret5.length
          ? '폐기가<br><em>임박</em>했습니다'
          : nEnf === ret5.length
            ? '곧 자동으로<br><em>적용</em>됩니다'
            : '공식 목록에<br><em>변화</em>가 있습니다',
      lead: nEnf === ret5.length ? leadEnf : nEnf ? leadMix : leadRet,
      listTitle: '항목별로 해야 할 일',
      items: ret5,
      cta: nRev ? '철회 <em>확인</em> 후 작업 재검토'
        : nEnf === ret5.length ? '미리 <em>켜서</em> 영향 확인'
        : '해당하는 항목이 <em>있는지</em> 확인',
      ctaSub: nEnf === ret5.length
        ? 'Setup ▸ Release Updates 에서 테스트·활성화하세요'
        : '우리 구축물·제안 목록에 쓰이는 곳부터 찾으세요',
      srcTop: nEnf === ret5.length
        ? '출처 · 공식 릴리스 노트 (Release Updates)'
        : nEnf
          ? '출처 · 공식 폐기 목록 (KB 000381744) · 릴리스 노트'
          : '출처 · 공식 폐기 목록 (KB 000381744)',
      srcSub: 'help.salesforce.com',
      height: 700 + ret5.length * 210   // 근사치 — 실제 캡처는 측정값을 쓴다
    };
  }
} catch (e) {
  // 폐기 감시를 아직 안 돌렸거나 파일이 없으면 이 카드는 그냥 없다.
  // 카드 1~4 렌더를 막을 이유가 없다.
  if (e.code !== 'ENOENT') console.error('  폐기 카드 생략:', e.message);
}

// ═══ 이벤트 카드 (자동 생성) ════════════════════════════════
// content/events.json 의 예정 행사 → event 포스터. 항목키 ev::<key> 로
// 발송 이력을 남겨 같은 행사가 두 번 나가지 않는다 (폐기 항목과 같은 메커니즘).
// D-day는 렌더 시점에 계산한다. 카드가 하루 뒤에 다시 나가면 숫자가 맞아야 한다.
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const asciiSlug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 48) || 'event';

let eventCards = [];   // [{ name, card, hero, meta }]
try {
  const ev = JSON.parse(readFileSync(resolve(ROOT, 'content/events.json'), 'utf8'));
  const already = sentItemKeys();
  const upcoming = (ev.events || [])
    .map(e => ({ ...e, dday: Math.ceil((new Date(e.startISO) - new Date()) / 86400000) }))
    .filter(e => e.dday >= 0)
    .filter(e => !already.has(`ev::${e.key}`))
    .slice(0, 3);   // 한 번에 3장까지 — 나머지는 다음 실행에서 나간다

  eventCards = upcoming.map(e => {
    const cur = CURATED_EVENTS[e.url] || {};
    const kst = new Date(new Date(e.startISO).getTime() + 9 * 3600e3);
    const isTbc = e.source === 'trailblazer';
    const name = 'event-' + asciiSlug(e.key);

    // 대표 이미지 — fetch-events 가 content/event-images/ 에 받아둔 파일을
    // 데이터 URI로 박는다. 캡처가 file:// 로 열리므로 원격 참조는 안 쓴다.
    // 어젠다가 있는 카드(큐레이션)는 공간이 이미 차 있어 이미지를 넘기지 않는다.
    // 파일이 없으면 이미지 없이 간다 — 카드 자체를 막을 이유가 없다.
    let img = null;
    if (e.image && !(cur.agenda || []).length) {
      try {
        const ext = e.image.split('.').pop().toLowerCase();
        const b64 = readFileSync(resolve(ROOT, 'content', e.image)).toString('base64');
        img = { src: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`, alt: e.title };
      } catch { /* 없으면 없는 대로 */ }
    }
    const card = {
      kind: isTbc ? 'TRAINING · WEBINAR' : 'EVENT',
      badge: 'official',
      badgeLabel: isTbc ? '교육 · 웨비나' : '이벤트',
      host: e.host,
      dday: e.dday,
      date: {
        mon: `${MON[kst.getUTCMonth()]} ${kst.getUTCFullYear()}`,
        day: String(kst.getUTCDate()),
        dow: DOW[kst.getUTCDay()],
        time: e.time || null,
        zone: e.time ? 'KST' : null
      },
      headline: cur.headline || esc0(e.title),
      lead: cur.lead || esc0(e.lead),
      img,
      where: cur.where || {
        big: e.format || (e.badge ? e.badge.split('|')[0].trim() : '행사'),
        small: e.venueName || '상세 페이지 확인',
        sub: e.venueAddr || ''
      },
      who: cur.who || null,
      agendaNote: cur.agendaNote || '',
      agenda: cur.agenda || [],
      cta: isTbc
        ? '등록은 <em>Trailblazer Community</em>에서' + (e.format === '오프라인' ? ' · 오프라인이라 정원 있음' : '')
        : '상세·등록은 <em>salesforce.com/kr</em>에서',
      srcTop: isTbc ? '출처 · Trailblazer Community' : '출처 · Salesforce 이벤트',
      srcSub: isTbc ? 'trailblazercommunitygroups.com' : 'salesforce.com/kr/events'
    };
    // 발송기용 메타 — 캡션에 D-day를 쓰지 않는다. 하루 뒤에 다시 보내도 틀리지 않게.
    const md = `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}(${DOW[kst.getUTCDay()][0]})`;
    const meta = {
      png: name + '.png',
      badge: 'official', capEmoji: 'event',
      title: `${e.title.slice(0, 48)} (${md})`,
      cap: {
        status: md + (e.time ? ` ${e.time.split(' ')[0]} 시작` : ''),
        cycle: [e.format, e.venueName].filter(Boolean).join(' · ') || e.host,
        what: e.title.slice(0, 60),
        action: '상세 페이지에서 등록', actionEmoji: 'signup'
      },
      fileTitle: `${e.startISO.slice(0, 10)} event ${asciiSlug(e.key)}`,
      lead: card.lead,
      itemKeys: [`ev::${e.key}`],
      url: e.url,
      links: [
        ['행사 상세 · 등록', e.url],
        ...(e.groupUrl && e.groupUrl !== e.url ? [[`${e.host} — 소스 페이지`, e.groupUrl]] : [])
      ]
    };
    return { name, card, meta };
  });
  const skippedSent = (ev.events || []).length - upcoming.length;
  if (eventCards.length) {
    console.log(`\n이벤트 카드 ${eventCards.length}장${skippedSent > 0 ? ` (지난·발송됨·초과 ${skippedSent}건 제외)` : ''}`);
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.error('  이벤트 카드 생략:', e.message);
}

// ═══ 블로그 카드 (자동 생성) ════════════════════════════════
// content/blog.json 의 글 중 아직 안 보낸 것만 roundup 으로 묶는다.
// 소스 셋(kr · developer · admin)을 한 장에 섞는다. 정상 상태에서는 셋을 합쳐도
// 하루 1~3건이라 소스별로 카드를 쪼개면 1건짜리 카드가 세 장 나간다.
// 대신 항목 배지로 어디서 온 글인지 구분한다.
// "새 글" 판정은 수집기가 이미 했다 (게시일 창) — 여기서는 발송 이력만 본다.
// 원문 링크는 PNG에 못 넣으므로 발송기의 링크 스레드에 붙는다.
const BLOG_MAX = 9;   // 3열 그리드라 9건이 3줄로 꽉 찬다
let blogCard = null, blogItems = [], blogKeys = [], blogLinks = [];
try {
  const bj = JSON.parse(readFileSync(resolve(ROOT, 'content/blog.json'), 'utf8'));
  const already = sentItemKeys();
  // itemKey 는 수집기가 소스별 네임스페이스로 만든다 (blog:: / dev:: / adm::).
  // 예전 파일에는 없으므로 없으면 기존 규칙으로 되돌린다.
  const keyOf = p => p.itemKey || `blog::${p.key}`;
  const unsent = (bj.posts || []).filter(p => !already.has(keyOf(p)));

  // 소스별로 돌려 담는다. 날짜순으로만 자르면 발행량이 많은 kr 이 상한을 다 먹고
  // developer·admin 이 한 건도 안 실린다 (실측: 9건 중 kr 8건 · admin 1건 · dev 0건).
  // 각 소스에서 최신순으로 한 건씩 번갈아 뽑아 세 곳이 모두 보이게 한다.
  const bySource = new Map();
  for (const p of unsent) {
    const k = p.source || 'kr';
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k).push(p);
  }
  const queues = [...bySource.values()];
  const fresh = [];
  while (fresh.length < BLOG_MAX && queues.some(q => q.length)) {
    for (const q of queues) {
      if (!q.length) continue;
      fresh.push(q.shift());
      if (fresh.length === BLOG_MAX) break;
    }
  }
  // 카드 안에서는 다시 최신순으로 읽히게 정렬한다
  fresh.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (unsent.length > fresh.length) {
    const left = unsent.length - fresh.length;
    console.log(`  블로그 ${left}건은 이번 카드에서 뺐습니다 (한 장 ${BLOG_MAX}건 상한) — 다음 실행에서 나갑니다.`);
  }
  // 시각적으로 단조롭지 않게 차분한 자세를 돌려 쓴다 — 내용 기반 판정이 아니라
  // 연출 다양성용이다 (블로그 글은 전부 '읽을거리'라 director 규칙이 못 가른다).
  const POSES = [['point', 'look'], ['jump', 'happy'], ['lean', 'look'],
                 ['check', 'happy'], ['wave', 'wink'], ['base', 'neutral']];
  blogItems = fresh.map((p, i) => ({
    badge: 'official',
    badgeLabel: p.sourceLabel || p.category || 'BLOG',
    pose: POSES[i % POSES.length][0], expr: POSES[i % POSES.length][1],
    title: esc0(p.title),
    // 저자가 쓴 완결 문장 요약(yoast description). 예전에는 WordPress excerpt —
    // 도입부를 글자수로 자른 것 — 를 썼는데 무슨 글인지가 안 나왔다.
    // 요약이 없는 글은 문장을 지어내지 않고 비워 둔다.
    sum: p.summary ? esc0(p.summary) : '',
    meta: [p.host, p.date, p.readMin ? `${p.readMin}분 읽기` : null,
           (p.topics || []).join(' · ') || null].filter(Boolean).join('  ·  '),
    // 원문의 H2/H3 헤딩. "링크 스레드에서 열기 — blog/what-is-soma-and-when…" 처럼
    // 잘린 슬러그를 보여주던 자리다 — 그건 정보가 아니었다.
    doLabel: (p.covers || []).length ? '다루는 내용' : '원문',
    doText: (p.covers || []).length
      ? esc0(p.covers.join(' · '))
      : '스레드 링크에서 원문 확인'
  }));
  blogKeys = fresh.map(keyOf);
  blogLinks = fresh.map(p => [p.title.slice(0, 72), p.url]);
  if (blogItems.length) {
    const srcs = [...new Set(fresh.map(p => p.sourceLabel).filter(Boolean))];
    // 감시 중인 소스 수는 수집분 전체에서 센다. 이번 카드에 한 소스만 실렸어도
    // "블로그 3곳을 보고 있다"는 사실은 그대로다.
    const watched = new Set((bj.posts || []).map(p => p.source).filter(Boolean)).size || 1;
    blogCard = {
      badge: 'official', badgeLabel: 'BLOG',
      cycle: `공식 블로그 ${watched}곳 · ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)} KST 기준`,
      headline: '공식 블로그에<br><em>새 글</em>이 올라왔습니다',
      lead: '세일즈포스 코리아 · Developer · Admin 공식 블로그의 새 글입니다. 원문 링크는 슬랙 스레드에 붙습니다.',
      listTitle: '새로 올라온 글',
      items: blogItems,
      cta: `새 글 <em>${blogItems.length}건</em> · 원문은 스레드에`,
      ctaSub: '읽고 싶은 글만 골라 여세요',
      srcTop: '출처 · 세일즈포스 공식 블로그',
      srcSub: 'kr/blog · developer · admin',
      height: 700 + Math.ceil(blogItems.length / 3) * 320
    };
    console.log(`\n블로그 카드 — 새 글 ${blogItems.length}건 (전체 ${bj.posts.length}건 중) · 소스 ${srcs.join(', ')}`);
  } else if ((bj.posts || []).length) {
    console.log(`\n블로그 카드 생략 — ${bj.posts.length}건 전부 이미 발송된 글입니다.`);
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.error('  블로그 카드 생략:', e.message);
}

// ═══ 렌더 ═══════════════════════════════════════════════════
mkdirSync(resolve(ROOT, 'out/cards'), { recursive: true });

// 지난 실행의 HTML을 먼저 지운다. 폐기 카드는 변화가 있는 날에만 생기는데,
// 조용한 날에 옛 파일이 남아 있으면 shoot.sh 가 그걸 다시 캡처해서 어제 소식이
// 오늘 발송 후보로 올라온다. 카드 목록은 매 실행마다 새로 정해져야 한다.
for (const f of readdirSync(resolve(ROOT, 'out/cards'))) {
  if (f.endsWith('.html')) unlinkSync(resolve(ROOT, 'out/cards', f));
}

// 카드 높이는 콘텐츠가 정한다. 손으로 픽셀을 맞추면 항목 수가 바뀔 때마다
// 하단 밴드가 잘리거나 빈 공간이 남는다(둘 다 실제로 겪었다).
// measure 모드로 scrollHeight를 title에 실어 보내고, bin/shoot.sh가 그 값으로 캡처한다.
const page = (html, measure) => `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>브릭 뉴스 카드</title><style>${TOKENS}${GPT_DIRECTED_CSS}${EDITORIAL_INFOGRAPHIC_CSS}${EDITORIAL_DYNAMIC_CSS}</style>
<style>.sheet,.poster{height:auto!important;min-height:0}</style></head>
<body style="width:max-content">${html}` +
(measure ? `<script>{const el=document.querySelector('.sheet,.poster,.gpt-directed-card,.editorial-infographic,.editorial-infographic-dynamic,.editorial-infographic-full');
document.title=el?'WH:'+el.scrollWidth+'x'+el.scrollHeight:'WH:FAIL';}<\/script>` : '') +
  `</body></html>`;

const built = [
  // 브리프가 존재하는데 무효면(handoffBriefBroken) 폴백 스킨으로도 안 그린다 —
  // 낡은 하드코딩 내용이 브리프 카드 행세를 하며 나가는 것을 막는다.
  ...((!handoffBriefBroken && (handoffBackground || dynamicInfographicBackground)) ? [['release-order-dynamic-infographic', 1536,
    renderDynamicEditorialInfographic(handoffCard, { background: handoffBackground || dynamicInfographicBackground, layoutMode: handoffLayoutMode })]] : []),
  ...(infographicBackground ? [['release-order-infographic', 1536,
    renderEditorialInfographic(editorialInfographicCard, { background: infographicBackground })]] : []),
  ...(gptDirectedBackground ? [['gpt-image2-release-concept', 1400,
    renderGptDirectedCard(gptDirectedReleaseCard, { background: gptDirectedBackground })]] : []),
  ['deepdive-release-update', card1.height, NewsCard.deepdive(card1, {
    flat: logoMark,
    hero: releaseUpdateHero,
    band: mascot('point', 'look', BRICK_ON_DARK, 'b1')
  })],
  ['deepdive-retired', card2.height, NewsCard.deepdive(card2, {
    flat: logoMark,
    hero: mascot('tumble', 'dead', BRICK, 'h2', true),
    band: mascot('base', 'skeptical', BRICK_ON_DARK, 'b2')
  })],
  // staged 가 null 이면 템플릿이 hero/band 폴백을 탄다. staging 을 빼면
  // 예전 배치로 그대로 되돌아간다.
  ...BEHAVIOR_CARDS.map((b, i) => [b.name, b.card.height, NewsCard.deepdive(b.card, {
    flat: logoMark,
    staged: staged(b.card, 'st' + i + '_'),
    hero: b.pose ? mascot(b.pose[0], b.pose[1], BRICK, 'hb' + i, true) : null,
    band: mascot(b.band[0], b.band[1], BRICK_ON_DARK, 'bb' + i)
  })]),
  ['roundup-admin-dev', card3.height, NewsCard.roundup(card3, {
    flat: logoMark,
    items: items.map((it, i) => mascot(it.pose, it.expr, BRICK, 'i' + i)),
    band: mascot('wave', 'happy', BRICK_ON_DARK, 'b3')
  })],
  // 포스터는 좌측 어두운 레일에 마스코트가 들어간다 → 어두운 배경용 윤곽선
  // 자동 수집 이벤트 — 예정 행사가 없거나 전부 발송됐으면 카드도 없다.
  ...eventCards.map((e, i) => [e.name, 0, NewsCard.event(e.card, {
    flat: logoMark,
    hero: mascot('wave', 'wink', BRICK_ON_DARK, 'he' + i)
  })]),
  // 변화가 없으면 카드가 아예 없다. 조용한 날에 빈 카드를 내지 않는다.
  ...(card5 ? [['roundup-retirements', card5.height, NewsCard.roundup(card5, {
    flat: logoMark,
    items: ret5.map((it, i) => mascot(it.pose, it.expr, BRICK, 'r' + i)),
    band: mascot('check', 'wide', BRICK_ON_DARK, 'b5')
  })]] : []),
  // 블로그 새 글 — 전부 발송된 날은 카드가 없다.
  ...(blogCard ? [['roundup-blog', blogCard.height, NewsCard.roundup(blogCard, {
    flat: logoMark,
    items: blogItems.map((it, i) => mascot(it.pose, it.expr, BRICK, 'g' + i)),
    band: mascot('lean', 'look', BRICK_ON_DARK, 'b6')
  })]] : [])
];

// ── 폐기 카드 메타 → 발송기 ──
// 발송기의 CARDS 는 사람이 쓴 카드 4장을 하드코딩한다. 폐기 카드는 매일 내용이
// 달라지므로 그 배열에 정적으로 넣을 수 없다. 렌더러가 카드를 정의하고
// 발송기가 이 파일을 읽어 실행한다.
//
// itemKeys 가 핵심이다. 발송에 성공하면 발송기가 이 키들을 out/sent.json 에
// 기록하고, 다음 렌더는 그 항목을 카드에서 뺀다. 카드 단위 제목으로는 중복을
// 막을 수 없다 — 한 장에 여러 항목이 섞이고 그 조합이 매일 달라지기 때문이다.
const CARD_META = resolve(ROOT, 'out/retirement-card.json');
if (card5) {
  const kinds = {
    reversed: ret5.filter(i => i.badge === 'reversed').length,
    imminent: ret5.filter(i => /^D-/.test(i.badgeLabel)).length,
    sale_end: ret5.filter(i => i.badgeLabel === '판매 중단').length,
    enforced: ret5.filter(i => i.badgeLabel === '신규 강제 변경').length,
    other: 0
  };
  kinds.other = ret5.length - kinds.reversed - kinds.imminent - kinds.sale_end - kinds.enforced;
  const bits = [];
  if (kinds.reversed) bits.push(`철회 ${kinds.reversed}`);
  if (kinds.imminent) bits.push(`임박 ${kinds.imminent}`);
  if (kinds.sale_end) bits.push(`판매 중단 ${kinds.sale_end}`);
  if (kinds.enforced) bits.push(`강제 변경 ${kinds.enforced}`);
  if (kinds.other) bits.push(`기타 ${kinds.other}`);

  // 카드 메타 JSON 은 원자적으로 쓴다 — 반쪽 파일이 남으면 발송기가 크게 실패한다
  writeJson(CARD_META, {
    png: 'roundup-retirements.png',
    // 날짜를 넣어도 된다. 중복은 itemKeys 로 막으므로 카드 제목은 슬랙에서
    // 찾기 좋은 형태가 우선이다.
    fileTitle: `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)} retirement-changes`,
    itemKeys: ret5Keys,
    badge: card5.badge,
    capEmoji: kinds.reversed ? 'ok' : (kinds.imminent || kinds.enforced) ? 'alert' : 'dead',
    cap: {
      status: kinds.reversed ? '폐기 계획 철회'
        : kinds.imminent ? '폐기 임박'
        : kinds.enforced === ret5.length ? '신규 강제 변경'
        : '폐기 목록 변화',
      cycle: kinds.enforced === ret5.length ? '릴리스 업데이트' : '공식 폐기 목록',
      what: bits.join(' · '),
      action: kinds.enforced === ret5.length
        ? 'Release Updates 에서 미리 켜서 영향 확인'
        : '해당하는 항목이 있는지 확인',
      actionEmoji: 'wrench'
    },
    lead: card5.lead,
    items: ret5.map(i => ({ badgeLabel: i.badgeLabel, title: i.title })),
    links: [
      ['공식 폐기 목록 — Salesforce Active Product & Feature Retirements',
       'https://help.salesforce.com/s/articleView?id=000381744&language=en_US&type=1'],
      ['지난 폐기 이력 — Past Product & Feature Retirements',
       'https://help.salesforce.com/s/articleView?id=000381733&language=en_US&type=1'],
      // 강제 변경이 섞인 날에만 릴리스 노트 인덱스를 추가한다
      ...(kinds.enforced ? [
        ['Release Updates — Salesforce Release Notes',
         'https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&language=en_US&type=5']
      ] : [])
    ]
  });
  console.log(`\nout/retirement-card.json — 항목 ${ret5Keys.length}건 (${bits.join(' · ')})`);
} else {
  // 카드가 없으면 메타도 지운다. 남겨두면 발송기가 없는 PNG를 보내려 한다.
  try { unlinkSync(CARD_META); } catch { /* 없으면 됐다 */ }
}

// ── 이벤트·블로그 카드 메타 → 발송기 ──
// 폐기 카드와 같은 패턴이다. 렌더러가 카드를 정의하고 발송기가 읽어 실행한다.
// itemKeys(ev::… / blog::…)가 발송 성공 시 이력에 기록돼 다음 렌더에서 빠진다.
// 동작 변경 카드 메타 — 발송기가 읽는다 (이벤트 카드와 같은 패턴)
writeJson(resolve(ROOT, 'out/behavior-cards.json'),
  BEHAVIOR_CARDS.map(b => ({
    png: b.name + '.png', badge: b.card.badge, capEmoji: b.card.badge === 'retired' ? 'dead' : 'alert',
    title: String(b.card.headline).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    cap: { status: b.capStatus, cycle: b.capCycle, what: b.capWhat,
           action: '스레드에서 공식 원문 확인', actionEmoji: 'link' },
    fileTitle: b.fileTitle,
    lead: String(b.card.lead).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    links: b.links
  })));
console.log(`out/behavior-cards.json — ${BEHAVIOR_CARDS.length}장`);

const EVENT_META = resolve(ROOT, 'out/event-cards.json');
if (eventCards.length) {
  writeJson(EVENT_META, eventCards.map(e => e.meta));
  console.log(`out/event-cards.json — ${eventCards.length}장`);
} else {
  try { unlinkSync(EVENT_META); } catch { /* 없으면 됐다 */ }
}

const BLOG_META = resolve(ROOT, 'out/blog-card.json');
if (blogCard) {
  writeJson(BLOG_META, {
    png: 'roundup-blog.png',
    badge: 'official', capEmoji: 'new',
    title: '세일즈포스 공식 블로그 새 글',
    cap: {
      status: '공식 블로그 새 글',
      // 이번 카드에 실제로 실린 소스만 쓴다 — 없는 소스를 캡션에 적으면 오보다
      cycle: [...new Set(blogItems.map(i => i.badgeLabel))].join(' · '),
      what: `${blogItems.length}건`,
      action: '스레드 링크에서 원문 확인', actionEmoji: 'link'
    },
    fileTitle: `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)} blog new-posts`,
    lead: blogCard.lead,
    items: blogItems.map(i => ({ badgeLabel: i.badgeLabel, title: i.title })),
    itemKeys: blogKeys,
    links: blogLinks
  });
  console.log('out/blog-card.json — 새 글 ' + blogItems.length + '건');
} else {
  try { unlinkSync(BLOG_META); } catch { /* 없으면 됐다 */ }
}

// ── 갤러리 ──
const NOTE = {
  'deepdive-release-update': ['alert + wide', '양팔 올림 · 놀란 눈 — 기한 있는 릴리스 업데이트'],
  'deepdive-retired': ['tumble + dead', '무너짐 · X 눈 — 이미 제거된 기능'],
  'roundup-admin-dev': ['6종 혼합 + wave', 'alert / tumble / jump / check / point / lean'],
  'roundup-retirements': ['유형별 + check', '공식 폐기 목록·릴리스 업데이트 변화 — 자동 생성. 철회는 check+wide'],
  'roundup-blog': ['차분한 자세 혼합', '공식 블로그 3곳 새 글 — 자동 생성. 원문 링크는 스레드'],
  ...Object.fromEntries(eventCards.map(e =>
    [e.name, ['wave + wink', `행사 포스터 — ${e.card.host} · 자동 수집`]]))
};
const S = 0.46;
const gallery = `<title>Summer '26 admin·developer 카드뉴스</title>
<style>${TOKENS}${GPT_DIRECTED_CSS}</style>
<style>
  body { background:#E9EEF2; color:#0F1922; font-family:var(--sans); margin:0; padding:40px 24px 80px; }
  @media (prefers-color-scheme: dark) { body { background:#0A0E12; color:#E6EDF3; } }
  :root[data-theme="dark"] body { background:#0A0E12; color:#E6EDF3; }
  :root[data-theme="light"] body { background:#E9EEF2; color:#0F1922; }
  .wrap { max-width:1680px; margin:0 auto; display:flex; flex-direction:column; gap:34px; }
  header h1 { margin:0 0 10px; font-size:clamp(28px,4vw,44px); line-height:1.14;
              letter-spacing:-.03em; font-weight:800; }
  header h1 em { font-style:normal; color:#2F7CB8; }
  header p { margin:0; max-width:66ch; font-size:17px; line-height:1.6; opacity:.74; }
  .eyebrow { font-family:var(--mono); font-size:11px; letter-spacing:.16em;
             text-transform:uppercase; color:#2F7CB8; margin-bottom:10px; }
  .row { display:grid; grid-template-columns:repeat(auto-fit,minmax(${Math.round(1080 * S)}px,1fr));
         gap:28px; align-items:start; }
  figure { margin:0; display:flex; flex-direction:column; gap:12px; }
  /* transform:scale은 레이아웃 높이에 반영되지 않아 슬롯 높이를 손으로 줘야 했다.
     zoom은 레이아웃에 반영되므로 카드 높이가 바뀌어도 슬롯이 따라온다. */
  .slot { width:${Math.round(1080 * S)}px; border-radius:10px; overflow:hidden;
          box-shadow:0 3px 14px rgba(14,23,32,.13); background:#fff; }
  .slot .sheet { zoom:${S}; height:auto!important; }
  figcaption { display:flex; flex-direction:column; gap:3px; width:${Math.round(1080 * S)}px; }
  figcaption .t { font-size:16px; font-weight:700; letter-spacing:-.01em; }
  figcaption .m { font-family:var(--mono); font-size:12px; color:#2F7CB8; }
  figcaption .d { font-size:13.5px; opacity:.68; line-height:1.5; }
  .note { border-left:3px solid #2F7CB8; padding:18px 22px; background:rgba(47,124,184,.07);
          font-size:14.5px; line-height:1.65; max-width:84ch; }
  .note b { font-weight:800; }
</style>
<div class="wrap">
  <header>
    <div class="eyebrow">Salesforce 카드뉴스</div>
    <h1>Summer '26 — <em>admin·developer</em>가 알아야 할 것</h1>
    <p>내용은 <code>help.salesforce.com</code> 공식 릴리스 노트 원문입니다. Aura SPA라서
       HTML로는 본문이 안 나와 Chrome 렌더링으로 What / Where / When / How를 뽑았습니다.</p>
  </header>
  <div class="row">
${built.map(([name, h, html]) => {
  const n = NOTE[name] || ['', ''];
  return `    <figure>
      <div class="slot">${html}</div>
      <figcaption><span class="t">${name}</span><span class="m">${n[0]}</span>
        <span class="d">${n[1]}</span></figcaption>
    </figure>`;
}).join('\n')}
  </div>
  <div class="note">
    이 카드는 <b>사외 공유용</b>입니다. 그래서 두 가지를 넣지 않습니다 —
    <b>고객사·프로젝트 이름</b>(컴플라이언스)과 <b>내부 평가 지표·해석</b>(우리가 무엇을 먼저
    볼지 고르는 값이라 읽는 사람에게 쓸모가 없습니다). 대신
    <b>지금과 뭐가 다른가 · 어느 에디션인가 · Setup 어디를 누르나 · 뭘 해야 하나</b>만 담습니다.
    <code>bash bin/audit-share.sh</code> 가 발송 전에 이걸 검사합니다.
  </div>
</div>`;

writeFileSync(resolve(ROOT, 'out/cards-gallery.html'), gallery);

for (const [name, h, html] of built) {
  writeFileSync(resolve(ROOT, `out/cards/${name}.html`), page(html, false));
  writeFileSync(resolve(ROOT, `out/cards/${name}.measure.html`), page(html, true));
  console.log(`out/cards/${name}.html`);
}
console.log('\n마스코트 모션');
console.log('  1 deepdive-release-update  alert + wide     (밴드 point)');
console.log('  2 deepdive-retired         tumble + dead    (밴드 base+skeptical)');
console.log('  3 roundup-admin-dev        ' + items.map(i => i.pose).join(' / ') + '  (밴드 wave)');
for (const e of eventCards) {
  console.log(`  · ${e.name}  wave + wink  (포스터 · 날짜 레일) · D-${e.card.dday}`);
}
if (card5) console.log('  · roundup-retirements     유형별 + check');
if (blogCard) console.log('  · roundup-blog            차분한 자세 혼합 + lean');
