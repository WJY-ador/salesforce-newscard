/**
 * UI 표면 시그니처 — 정규화·diff 순수 로직 (fetch-ui-surfaces.mjs 가 쓴다)
 *
 * 시그니처 = 화면에서 뽑은 컨트롤·라벨 텍스트 목록. 픽셀이 아니라 텍스트를 비교하는
 * 이유: 픽셀은 렌더링 편차(폰트·안티앨리어싱)로 매일 다르지만, "즐겨찾기 찾기"
 * 같은 새 컨트롤의 등장은 텍스트 목록의 added 한 줄로 정확히 잡힌다.
 */

/**
 * 컨트롤이 아닌 노이즈 라벨 — 화면 구성에 따라 매일 달라지고 뉴스 가치가 0이다.
 * 실측 2026-08-11 (shadow DOM 관통 후): 리스트뷰 컬럼 리사이즈 핸들의 aria-label
 * ("계정 이름 열 너비", "Account Name column width")이 컬럼 수만큼 쏟아졌다.
 *
 * 배너·토스트 닫기 버튼도 같은 부류다. 실측: 기준 org Setup 홈의 Marketing Cloud
 * 프로모션 배너 X 버튼("Close banner")과 Agentforce 안내 카드 X("Close")가
 * 2026-08-12·17·18·19 에는 잡혔다가 8/21 에 사라지고 8/24 에 다시 잡혀,
 * 같은 컨트롤을 removed(8/21 탈락) → added(8/24 탈락)로 두 번 판정하게 만들었다.
 * 배너 자체가 org 프로모션이라 Platform 공통 화면 변화가 아니다.
 */
const NOISE = [
  /(열 너비|column width)$/i,
  /(정렬됨|sorted)( (오름차순|내림차순|ascending|descending))?$/i,
  /^(close|닫기)( banner| 배너)?$/i
];

/** 환경 편차를 지운다 — 숫자·시각은 #, 공백 정리, 정렬·중복 제거. */
export function normalizeSignature(lines) {
  const out = new Set();
  for (const raw of lines || []) {
    let s = String(raw).replace(/\s+/g, ' ').trim();
    if (!s || s.length < 2 || s.length > 120) continue;
    if (NOISE.some(re => re.test(s))) continue;
    // 상대 시각·개수 같은 가변 숫자를 마스킹한다 — "3 items" 와 "5 items" 는 같은 컨트롤이다
    s = s.replace(/\d+/g, '#');
    out.add(s);
  }
  return [...out].sort();
}

/**
 * 스냅샷 마이그레이션 — 단일 트랙(`{surfaces}`) 시절 파일을 2트랙 구조로 올린다.
 * 종전 스냅샷은 소 scratch 로 수집한 것이므로 `tracks.scratch` 에 그대로 들어간다.
 * 마이그레이션 없이 2트랙 코드가 읽으면 prev 가 비어 전 표면이 baseline 으로 리셋되고,
 * 그날 진짜 변화를 영구히 놓친다 (2026-08-11).
 */
export function migrateSnapshot(prev) {
  if (!prev) return { tracks: {} };
  if (prev.tracks) return prev;
  if (prev.surfaces) return { ...prev, tracks: { scratch: { surfaces: prev.surfaces } }, surfaces: undefined };
  return { ...prev, tracks: {} };
}

/**
 * 라이선스 게이트 판별 — 라이선스 트랙에만 있고 소 scratch 트랙 어디에도 없는 컨트롤은
 * "라이선스로 열린 기능"이다 (2026-08-11 사용자 확정). 두 트랙의 차집합이 판별기다.
 * scratch 쪽은 표면을 가리지 않고 전부 합쳐서 본다 — 같은 컨트롤이 다른 표면에 있으면
 * 라이선스 게이트가 아니라 배치 변화이기 때문이다.
 */
export function splitLicenseGated(lines, scratchSurfaces) {
  const all = new Set();
  for (const s of Object.values(scratchSurfaces || {})) for (const l of s || []) all.add(l);
  const gated = [], common = [];
  for (const l of lines || []) (all.has(l) ? common : gated).push(l);
  return { gated, common };
}

/**
 * 전역 크롬 제거 — **모든 표면에 공통으로 있는 줄**은 헤더·유틸리티 바다 (2026-08-11).
 * 트랙 간 비교에서 이걸 빼야 한다. 근거: 기준 org 는 콘솔 앱으로 열려
 * 유틸리티 바(Omni-Channel·Dial Pad·Phone)가 6면 전부에 상주하는데 scratch 에는 그 앱이
 * 없어서, 뺄셈하면 유틸리티 바 10줄이 통째로 "라이선스로 열린 컨트롤"로 오인됐다.
 * 표면이 2면 미만이면 "전부 공통"의 의미가 없어 아무것도 빼지 않는다.
 */
export function stripGlobalChrome(surfaces) {
  const names = Object.keys(surfaces || {}).filter(n => (surfaces[n] || []).length);
  if (names.length < 2) return { ...surfaces };
  let common = new Set(surfaces[names[0]]);
  for (const n of names.slice(1)) {
    const s = new Set(surfaces[n]);
    common = new Set([...common].filter(x => s.has(x)));
  }
  const out = {};
  for (const n of Object.keys(surfaces || {})) out[n] = (surfaces[n] || []).filter(l => !common.has(l));
  return out;
}

/**
 * 게이트 후보 필터 — 구조 시그니처에서 **의미 있는 식별자만** 남긴다 (2026-08-11 실측).
 * 두 org 는 앱·데이터·설치 패키지가 달라서 구조 시그니처를 그냥 뺄셈하면 데모 자산이
 * 쏟아진다: 실측 103개 중 진짜는 6개였고, 나머지는 레코드 링크(`/lightning/r/…`),
 * 컴포넌트 id(`fd#d#f#…`), 데모 패키지 태그(`sdoService…`·`qbranch_…`·`omni-…`)였다.
 * 그래서 화이트리스트로 좁힌다 — 표준 액션 식별자와 앱·Setup 노드 경로만 본다.
 * 이 셋이 "라이선스로 열리는 기능"이 실제로 드러나는 자리다 (Setup 노드·앱·리스트 액션).
 */
const GATE_KEEP = /^(app:|sfdc:StandardButton\.|sfdc:TabDefinition\.(?!standard-)|\/lightning\/(app|setup|cmp|n)\/)/;

/**
 * 2026-08-11 2차 실측으로 제외한 것들:
 *   - `sfdc:RecordField.…` — 레코드 페이지 필드. 커스텀 필드·레이아웃 차이라 라이선스와 무관
 *     (실측 13개가 전부 데모 org 의 커스텀 필드였다: Grade__c · Tier__pc · ru_TotalAmount__pc)
 *   - `sfdc:TabDefinition.standard-…` — 표준 탭. 앱 구성 차이일 뿐이다
 *   - `/lightning/r/…` — 레코드 링크 (데이터)
 * 남기는 것: 앱 메뉴 항목(`app:`) · 표준 버튼 · 커스텀 탭 · 앱·Setup·컴포넌트 경로.
 */
export function gateCandidates(lines) {
  return (lines || []).filter(l => GATE_KEEP.test(l));
}

/**
 * 구조 시그니처 정규화 — 언어를 타지 않는 식별자만 남긴다 (2026-08-11).
 * 라벨("새로 만들기" vs "New")은 org 언어에 따라 달라서 트랙 간 비교가 성립하지 않는다.
 * 대신 링크 경로·버튼 name·액션 식별자를 쓴다 — 이 값들은 언어와 무관하다.
 * 레코드 ID(15/18자)·쿼리스트링·숫자는 마스킹한다.
 */
export function normalizeStructural(items) {
  const out = new Set();
  for (const raw of items || []) {
    let s = String(raw).trim();
    if (!s) continue;
    s = s.replace(/^https?:\/\/[^/]+/, '');            // origin 제거 — org 마다 다르다
    s = s.replace(/[?#].*$/, '');                       // 쿼리·프래그먼트 제거
    s = s.replace(/\b[a-zA-Z0-9]{15,18}\b/g, '#ID');    // 레코드 ID 마스킹
    s = s.replace(/\d+/g, '#');
    if (s.length < 3 || s.length > 160) continue;
    out.add(s);
  }
  return [...out].sort();
}

/**
 * 표면별 diff. 표면 자체가 사라진 경우(로드 실패)는 removed 로 세지 않고
 * failed 로 분리한다 — 화면이 안 뜬 것과 컨트롤이 없어진 것은 다른 사건이다.
 */
export function diffSurfaces(prev, cur) {
  const result = {};
  const names = new Set([...Object.keys(prev || {}), ...Object.keys(cur || {})]);
  for (const name of names) {
    const p = (prev || {})[name];
    const c = (cur || {})[name];
    if (!c || !c.length) { result[name] = { failed: true, added: [], removed: [] }; continue; }
    if (!p || !p.length) { result[name] = { baseline: true, added: [], removed: [] }; continue; }
    const ps = new Set(p), cs = new Set(c);
    result[name] = {
      added: c.filter(x => !ps.has(x)),
      removed: p.filter(x => !cs.has(x))
    };
  }
  return result;
}
