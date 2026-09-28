import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSignature, diffSurfaces } from '../bin/lib/ui-surface.mjs';

test('숫자는 마스킹된다 — "3 items"와 "5 items"는 같은 컨트롤이다', () => {
  const a = normalizeSignature(['3 items selected', '5 items selected']);
  assert.deepEqual(a, ['# items selected']);
});

test('공백 정리·정렬·중복 제거·길이 필터', () => {
  const r = normalizeSignature(['  New\n Account ', 'New Account', 'x', 'a'.repeat(200), '즐겨찾기 찾기']);
  assert.deepEqual(r, ['New Account', '즐겨찾기 찾기']);
});

test('새 컨트롤 등장은 added 한 줄로 잡힌다 — 즐겨찾기 검색창 시나리오', () => {
  const prev = { 'favorites-dropdown': ['Edit Favorites', 'My Favorites'] };
  const cur = { 'favorites-dropdown': ['Edit Favorites', 'Find Favorites', 'My Favorites'] };
  const d = diffSurfaces(prev, cur);
  assert.deepEqual(d['favorites-dropdown'].added, ['Find Favorites']);
  assert.deepEqual(d['favorites-dropdown'].removed, []);
});

test('수집 실패(빈 시그니처)는 removed 가 아니라 failed 다', () => {
  const d = diffSurfaces({ s: ['A', 'B'] }, { s: [] });
  assert.equal(d.s.failed, true);
  assert.deepEqual(d.s.removed, []);
});

test('이전 스냅샷이 없는 표면은 baseline 이다', () => {
  const d = diffSurfaces({}, { s: ['A'] });
  assert.equal(d.s.baseline, true);
});

// ── 2트랙 (2026-08-11) ────────────────────────────────
test('구 스냅샷({surfaces})은 tracks.scratch 로 이관된다 — baseline 리셋 방지', async () => {
  const { migrateSnapshot } = await import('../bin/lib/ui-surface.mjs');
  const m = migrateSnapshot({ note: 'n', surfaces: { 'setup-home': ['Quick Find'] } });
  assert.deepEqual(m.tracks.scratch.surfaces, { 'setup-home': ['Quick Find'] });
  assert.equal(m.surfaces, undefined);
});

test('이미 2트랙인 스냅샷은 그대로 통과, null 은 빈 tracks', async () => {
  const { migrateSnapshot } = await import('../bin/lib/ui-surface.mjs');
  const cur = { tracks: { scratch: { surfaces: {} }, license: { surfaces: {} } } };
  assert.equal(migrateSnapshot(cur), cur);
  assert.deepEqual(migrateSnapshot(null), { tracks: {} });
});

test('라이선스 트랙에만 있는 컨트롤은 gated, scratch 에도 있으면 common', async () => {
  const { splitLicenseGated } = await import('../bin/lib/ui-surface.mjs');
  const scratch = { 'listview-account': ['New', 'Import'], 'setup-home': ['Quick Find'] };
  const r = splitLicenseGated(['Analyze with Grid', 'New', 'Quick Find'], scratch);
  assert.deepEqual(r.gated, ['Analyze with Grid']);
  assert.deepEqual(r.common, ['New', 'Quick Find']);
});

test('scratch 트랙이 비면 전부 gated 로 보지 않는다 — 판별 근거가 없으면 판정도 없다', async () => {
  const { splitLicenseGated } = await import('../bin/lib/ui-surface.mjs');
  const r = splitLicenseGated(['Analyze with Grid'], {});
  assert.deepEqual(r.gated, ['Analyze with Grid']);   // 차집합 정의상 gated
  assert.deepEqual(r.common, []);
});

// ── 언어 무관 구조 시그니처 · 전역 크롬 제거 (2026-08-11) ──
test('구조 시그니처는 origin·쿼리·레코드ID·숫자를 지운다', async () => {
  const { normalizeStructural } = await import('../bin/lib/ui-surface.mjs');
  const r = normalizeStructural([
    'https://a.my.salesforce.com/lightning/r/Account/001Ka000004xYzAAB/view?ws=%2Fhome',
    '/lightning/r/Account/001Kb000009qWwCCD/view',
    'sfdc:StandardButton.Account.New',
    'x'
  ]);
  assert.deepEqual(r, ['/lightning/r/Account/#ID/view', 'sfdc:StandardButton.Account.New']);
});

test('전역 크롬(모든 표면 공통)은 제거된다 — 유틸리티 바 오인 방지', async () => {
  const { stripGlobalChrome } = await import('../bin/lib/ui-surface.mjs');
  const r = stripGlobalChrome({
    a: ['Omni-Channel', 'Dial Pad', 'New'],
    b: ['Omni-Channel', 'Dial Pad', 'Edit'],
    c: ['Omni-Channel', 'Dial Pad', 'Import']
  });
  assert.deepEqual(r, { a: ['New'], b: ['Edit'], c: ['Import'] });
});

test('표면이 1면뿐이면 아무것도 빼지 않는다 — "전부 공통"이 무의미하다', async () => {
  const { stripGlobalChrome } = await import('../bin/lib/ui-surface.mjs');
  assert.deepEqual(stripGlobalChrome({ a: ['X', 'Y'] }), { a: ['X', 'Y'] });
});

test('빈 표면은 공통 계산에서 빠지되 결과에는 남는다', async () => {
  const { stripGlobalChrome } = await import('../bin/lib/ui-surface.mjs');
  const r = stripGlobalChrome({ a: ['H', 'New'], b: ['H', 'Edit'], c: [] });
  assert.deepEqual(r, { a: ['New'], b: ['Edit'], c: [] });
});

test('게이트 판별을 구조 시그니처로 하면 언어가 달라도 성립한다', async () => {
  const { splitLicenseGated, stripGlobalChrome } = await import('../bin/lib/ui-surface.mjs');
  // 한국어 org(라이선스) vs 영어 org(scratch) — 링크 경로는 같고 Grid 만 추가된 상황
  const scratch = stripGlobalChrome({
    listview: ['/lightning/o/Account/list', 'sfdc:StandardButton.Account.New', 'HEADER'],
    setup: ['/lightning/setup/SetupOneHome/home', 'HEADER']
  });
  const license = stripGlobalChrome({
    listview: ['/lightning/o/Account/list', 'sfdc:StandardButton.Account.New', '/lightning/app/AIWorkbench', 'HEADER'],
    setup: ['/lightning/setup/SetupOneHome/home', 'HEADER']
  });
  const r = splitLicenseGated(license.listview, scratch);
  assert.deepEqual(r.gated, ['/lightning/app/AIWorkbench']);
});

test('게이트 후보 필터는 표준 액션·앱·Setup 경로만 남긴다 — 데모 자산 배제', async () => {
  const { gateCandidates } = await import('../bin/lib/ui-surface.mjs');
  const r = gateCandidates([
    'sfdc:StandardButton.Account.New',
    '/lightning/setup/DigitalWallet/home',
    '/lightning/app/AIWorkbench',
    '/lightning/r/Account/#ID/view',      // 레코드 링크 — 데이터라 제외
    'fd#d#f#a#e#dd#c#d',                  // 컴포넌트 id — 노이즈
    'tag:sdoservice-kakao-utility-bar',   // 데모 패키지 — 제외
    'home_topDealsContainer'
  ]);
  assert.deepEqual(r, ['sfdc:StandardButton.Account.New', '/lightning/setup/DigitalWallet/home', '/lightning/app/AIWorkbench']);
});

// ── 노이즈 라벨·화이트리스트 2차 조정 (2026-08-11) ──
test('컬럼 리사이즈·정렬 상태 라벨은 시그니처에서 빠진다', () => {
  const r = normalizeSignature(['계정 이름 열 너비', 'Account Name column width', 'Name sorted ascending', 'New Account']);
  assert.deepEqual(r, ['New Account']);
});

test('게이트 후보에서 레코드 필드·표준 탭은 빠지고 앱 메뉴·커스텀 탭은 남는다', async () => {
  const { gateCandidates } = await import('../bin/lib/ui-surface.mjs');
  const r = gateCandidates([
    'app:TabSet:AIWorkbench',
    'sfdc:TabDefinition.Tableau_Insights',
    'sfdc:StandardButton.Account.New',
    '/lightning/setup/DigitalWallet/home',
    'sfdc:RecordField.Account.Grade__c',      // 커스텀 필드 — 라이선스와 무관
    'sfdc:TabDefinition.standard-Quote',      // 표준 탭 — 앱 구성 차이
    '/lightning/r/Account/#ID/view'
  ]);
  assert.deepEqual(r, [
    'app:TabSet:AIWorkbench',
    'sfdc:TabDefinition.Tableau_Insights',
    'sfdc:StandardButton.Account.New',
    '/lightning/setup/DigitalWallet/home'
  ]);
});
